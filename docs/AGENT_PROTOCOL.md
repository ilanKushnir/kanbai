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
`inbox:read`, `inbox:write`, `comments:write`, `members:read`, `members:write`.

### Quick check

```bash
curl https://your-kanbai.app/api/v1/me \
  -H "Authorization: Bearer $KANBAI_KEY"
# → {
#   "agent": {...}, "workspaceId": "...", "scopes": [...],
#   "conventions": {
#     "descriptionFormat": "html",
#     "descriptionAllowedTags": ["p","b","i","u","h3","ul","ol","li","blockquote","a", ...],
#     "priorities": ["none","low","medium","high","urgent"],
#     "noteBuckets": ["today","tomorrow","next_week","next_month","general"]
#   }
# }
```

`conventions` is self-describing: read it on connect so you format ticket
descriptions (simple **HTML**, sanitized server-side) and set priorities correctly
without hardcoding.

---

## 2. REST API

Base URL: `https://your-kanbai.app/api/v1`. All bodies are JSON.

### Boards

```
GET  /boards                  # list boards (+ columns, labels)   scope: boards:read
GET  /boards/{boardId}        # board with all columns & tickets   scope: boards:read
POST /boards                  # create a board w/ columns+labels    scope: boards:write
```

**Create a board** (migration-friendly — define columns & labels up front):

```bash
curl -X POST https://your-kanbai.app/api/v1/boards \
  -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{
    "name": "Roadmap",
    "columns": [{"name":"Backlog"},{"name":"Doing"},{"name":"Done","isDone":true}],
    "labels": [{"name":"bug","color":"rose"},{"name":"feature","color":"iris"}],
    "createdAt": "2024-01-02T00:00:00.000Z"
  }'
# → { board: { id, slug, columns:[{id,name,isDone}], labels:[{id,name,color}] } }
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
    "description": "<p>Simple <b>HTML</b> supported.</p>",
    "priority": "high",
    "dueDate": "2026-06-20T17:00:00.000Z",
    "labelIds": ["lbl_bug"]
  }'
```

Fields: `boardId` (required), `title` (required), `columnId` (defaults to the
first column), `description` (**simple HTML** — `<p> <b> <i> <u> <h3> <ul>/<ol>/<li>
<blockquote> <a>`; sanitized server-side, anything else is stripped; plain text is
fine too), `priority` (`none|low|medium|high|urgent`), `dueDate` (ISO 8601 or null),
`assigneeType` (`user|agent`), `assigneeAgentId`, `labelIds[]`.

**Move a ticket**

```bash
curl -X POST https://your-kanbai.app/api/v1/tickets/tkt_123/move \
  -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{ "columnId": "col_done", "position": 0 }'
```

### Inbox (the "sort" queue)

When a human marks a captured note for ingestion (or sends it explicitly), it
lands in that agent's inbox.

```
GET  /inbox                   # notes queued to this agent          scope: inbox:read
POST /inbox/{noteId}/sort     # turn a note into a ticket           scope: inbox:write
```

A queued note includes the raw text, optional free-text `sortContext` from the
user, and any `attachments` (e.g. a voice memo as a base64 data URL). Each note
is scheduled for a **local calendar day** — the agent gets that plus coarse
hints so it can pick the right board/column and a sensible due date:

| Field | Meaning |
| --- | --- |
| `scheduledDay` | the local day the note is slated for, as `"YYYY-MM-DD"`, or `null` for unscheduled |
| `bucket` | coarse hint derived from `scheduledDay`: `today` · `tomorrow` · `next_week` · `next_month` · `general` |
| `priority` | user-set line priority: `none/low/medium/high/urgent` |
| `suggestedDueDate` | ISO 8601 due date (noon local) derived from `scheduledDay`, or `null` when unscheduled — apply it as-is or override |

The agent decides the board, column, priority, labels, and due date, then files
it (a good default: carry `priority` through and use `suggestedDueDate` as the
`dueDate` unless the note text implies otherwise):

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

### Members (for migration)

```
GET  /members                 # list workspace members (map assignees)   scope: members:read
POST /members                 # create/add a user to this workspace      scope: members:write
```

`POST /members` creates the user if their email is new (returns a one-time
`tempPassword` so you can onboard them) and adds them to the workspace:

```bash
curl -X POST https://your-kanbai.app/api/v1/members \
  -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{ "email":"jo@example.com", "name":"Jo", "role":"member",
        "boardAccess":[{"boardId":"brd_123","level":"edit"}] }'
# → { userId, email, created: true, tempPassword: "…" }
```

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

---

## 6. Migrating from Kanboard

An agent can move a whole [Kanboard](https://github.com/kanboard/kanboard)
instance into one Kanbai workspace. Read from Kanboard's JSON-RPC API
(`/jsonrpc.php`, Application/admin token), then write with the endpoints above.

### Recommended flow

1. **Users** → for each Kanboard user (`getAllUsers` / `getProjectUsers`), call
   `POST /api/v1/members` with their `email`, `name`, and `role`
   (`app-manager` → `admin`, else `member`). Keep a map `email → userId`.
2. **Project → Board** → for each project (`getAllProjects` + `getColumns`), call
   `POST /api/v1/boards` with the columns (mark the last/closed column
   `isDone: true`) and the project's categories+tags as `labels`.
3. **Tasks → Tickets** → `getAllTasks` (call with `status_id` **1 and 0** to get
   open + closed), then `POST /api/v1/tickets` per task, mapping:

| Kanboard | Kanbai field |
| --- | --- |
| `title`, `description` (Markdown) | `title`, `description` (convert Markdown → simple HTML) |
| `column` name | `columnName` (resolved on the board) |
| `category` name + `tags` | `labelNames` (auto-created) |
| `color` | add as a `labelNames` entry, or fold into description |
| `priority` | `priority` (`none/low/medium/high/urgent`) |
| `date_due` (epoch) | `dueDate` (ISO 8601) |
| `owner` email | `assigneeEmail` |
| `id` (per project) | `number` (preserves the task reference) |
| `date_creation` (epoch) | `createdAt` (ISO 8601) |
| `position` | order — create tasks in `position` order |

4. **Comments** → `getAllComments(task_id)` → `POST /api/v1/tickets/{id}/comments`.

### Mapping the concepts Kanbai models differently (lossless folds)

- **Subtasks** → append an HTML list to the ticket description
  (`<ul><li>done item</li></ul>`). Per-subtask assignee/time, if used, go inline in the line.
- **Swimlanes** → add the swimlane name as a `labelNames` entry (e.g. `lane:backend`).
- **Categories** (one per task) → a label; **tags** (many) → labels too.
- **Task links / relations** (blocks, relates) → a line in the description referencing
  the other ticket number (e.g. `Blocks #42`).
- **Time tracking** (estimated/spent) → a description line (e.g. `⏱ est 5h / spent 2h`).

This keeps every field — nothing is dropped, even where Kanbai has no native
column for it. Kanbai's per-board `#number` and done-column flag have **no
Kanboard equivalent**, so you gain referenceable IDs for free.
