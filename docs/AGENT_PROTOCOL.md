# Kanbai Agent Protocol

How an AI agent — **Hermes** (primary), Open Claw, Claude Code, Codex, or any
custom agent — connects to Kanbai, manages boards & tickets, and processes the
"to-sort" inbox. The protocol is designed to be secure by default and trivial to
implement on either side.

There are two channels:

| Direction | Channel | Trust mechanism |
| --- | --- | --- |
| **Agent → Kanbai** | REST API under `/api/v1` | Bearer **API key** |
| **Kanbai → Agent** | Webhook to the agent's own URL | **HMAC signature** (secret you set) |

---

## 1. Authentication (Agent → Kanbai)

Every `/api/v1` request must include the agent's API key:

```
Authorization: Bearer kbai_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

- Create the key in **Agents → Add agent** (or rotate an existing one). The
  plaintext is shown **once**; Kanbai stores only a salted SHA-256 hash.
- Keys are scoped. A call missing the required scope returns `403`.

**Scopes:** `boards:read`, `boards:write`, `tickets:read`, `tickets:write`,
`inbox:read`, `inbox:write`, `comments:write`.

### Quick check

```bash
curl https://your-kanbai.app/api/v1/me \
  -H "Authorization: Bearer $KANBAI_KEY"
# → { "agent": {...}, "workspaceId": "...", "scopes": [...] }
```

---

## 2. REST API

Base URL: `https://your-kanbai.app/api/v1`. All bodies are JSON.

### Boards

```
GET  /boards                  # list boards (+ columns, labels)   scope: boards:read
GET  /boards/{boardId}        # board with all columns & tickets   scope: boards:read
```

### Tickets

```
POST  /tickets                # create a ticket                    scope: tickets:write
GET   /tickets/{id}           # fetch a ticket                     scope: tickets:read
PATCH /tickets/{id}           # update fields                      scope: tickets:write
POST  /tickets/{id}/move      # move to column + position          scope: tickets:write
POST  /tickets/{id}/comments  # add a comment (as the agent)       scope: comments:write
```

**Create a ticket**

```bash
curl -X POST https://your-kanbai.app/api/v1/tickets \
  -H "Authorization: Bearer $KANBAI_KEY" \
  -H "content-type: application/json" \
  -d '{
    "boardId": "brd_123",
    "title": "Investigate flaky webhook retries",
    "description": "Markdown supported.",
    "priority": "high",
    "dueDate": "2026-06-20T17:00:00.000Z",
    "labelIds": ["lbl_bug"]
  }'
```

Fields: `boardId` (required), `title` (required), `columnId` (defaults to the
first column), `description`, `priority` (`none|low|medium|high|urgent`),
`dueDate` (ISO 8601 or null), `assigneeType` (`user|agent`),
`assigneeAgentId`, `labelIds[]`.

**Move a ticket**

```bash
curl -X POST https://your-kanbai.app/api/v1/tickets/tkt_123/move \
  -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{ "columnId": "col_done", "position": 0 }'
```

### Inbox (the "sort" queue)

When a human sends a captured note to an agent, it lands in that agent's inbox.

```
GET  /inbox                   # notes queued to this agent          scope: inbox:read
POST /inbox/{noteId}/sort     # turn a note into a ticket           scope: inbox:write
```

A queued note includes the raw text, optional free-text `sortContext` from the
user, and any `attachments` (e.g. a voice memo as a base64 data URL). The agent
decides the board, column, priority, labels, and due date, then files it:

```bash
curl -X POST https://your-kanbai.app/api/v1/inbox/note_123/sort \
  -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{
    "boardId": "brd_product",
    "title": "Follow up with design contractor on the icon set",
    "description": "From a captured note + voice memo.",
    "priority": "medium",
    "labelIds": ["lbl_design"]
  }'
```

This creates the ticket, links it to the note, and marks the note **sorted**.

---

## 3. Webhooks (Kanbai → Agent)

The agent registers **its own** webhook URL (Agents → Webhook URL). Kanbai POSTs
signed events there so the agent can react in real time instead of polling.

### Events

`note.queued` · `ticket.created` · `ticket.updated` · `ticket.moved` ·
`ticket.assigned` · `comment.created` · `ping`

### Request headers

```
Content-Type: application/json
X-Kanbai-Event:      ticket.assigned
X-Kanbai-Timestamp:  1781636734            # unix seconds
X-Kanbai-Signature:  sha256=<hex hmac>
X-Kanbai-Delivery:   <delivery id>         # idempotency key
```

### Signature & verification

Kanbai computes `HMAC_SHA256(secret, "{timestamp}.{rawBody}")` and sends it as
`X-Kanbai-Signature: sha256=<hex>`. **You** choose the `secret` (Agents →
Signing secret) and give the same value to your agent.

The agent must:
1. Recompute the HMAC over `` `${timestamp}.${rawRequestBody}` ``.
2. Compare in **constant time** to the signature header.
3. Reject if the timestamp is older than ~5 minutes (replay protection).

**Node.js**

```js
import crypto from "node:crypto";

function verify(req, rawBody, secret) {
  const ts = req.headers["x-kanbai-timestamp"];
  const sig = (req.headers["x-kanbai-signature"] || "").replace(/^sha256=/, "");
  const expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Math.abs(Date.now() / 1000 - Number(ts)) < 300;
}
```

**Python**

```python
import hmac, hashlib, time

def verify(headers, raw_body: bytes, secret: str) -> bool:
    ts = headers["X-Kanbai-Timestamp"]
    sig = headers.get("X-Kanbai-Signature", "").removeprefix("sha256=")
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return False
    return abs(time.time() - int(ts)) < 300
```

Use **Send test** in the Agents UI to fire a signed `ping` and confirm your
verification works. Delivery results (status, code, signature) are logged per
agent. Failed deliveries are retried up to 3 times with linear backoff.

---

## 4. Hermes quickstart (recommended setup)

Hermes is the primary orchestration agent. Wiring it up:

1. **Create the agent** — Agents → Add agent → *Hermes*. Copy the API key.
2. **Set the webhook** — paste Hermes's public endpoint (e.g.
   `https://hermes.example.com/kanbai/webhook`).
3. **Set the signing secret** — generate one in Kanbai (or paste your own) and
   configure the *same* secret in Hermes.
4. **Verify** — click **Send test**; Hermes should accept the signed `ping`.
5. **Go** — Hermes now receives `note.queued` events, reads the inbox, and files
   tickets via `POST /inbox/{id}/sort`. It can also self-assign work and comment.

A minimal Hermes loop:

```
on webhook "note.queued":            # or poll GET /api/v1/inbox
    verify signature → 401 if bad
    note = event.data.note
    plan = llm.decide(note.body, note.sortContext, note.attachments)
    POST /api/v1/inbox/{note.id}/sort  with plan(board, title, priority, ...)
    optionally POST a comment explaining the decision
```

---

## 5. Errors

```json
{ "error": { "message": "Missing required scope: tickets:write", "code": "missing_scope" } }
```

| Status | Meaning |
| --- | --- |
| 400 | malformed JSON |
| 401 | missing / invalid API key |
| 403 | agent disabled or missing scope |
| 404 | resource not in this agent's workspace |
| 422 | validation error (see `message`) |

All resources are scoped to the agent's workspace; cross-workspace access returns
`404` rather than leaking existence.
