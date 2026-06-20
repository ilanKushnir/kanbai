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
`inbox:read`, `inbox:write`, `notes:read`, `notes:write`, `comments:write`,
`members:read`, `members:write`.

> New agents are granted every scope by default. Agents created before
> `notes:read`/`notes:write` existed won't have them until you re-grant scopes
> in **Agents → Scopes** — their existing flows (inbox, tickets, boards) are
> unaffected.

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
fine too), `priority` (`none|low|medium|high|urgent`), `dueDate` (ISO 8601 — see
below — or null), `assigneeType` (`user|agent`), `assigneeAgentId`, `labelIds[]`.

#### `dueDate` contract

`dueDate` accepts ISO 8601 in any of these shapes and normalizes to a stable
instant server-side:

| Form | Example | Interpreted as |
| --- | --- | --- |
| date-only | `2026-06-20` | UTC midnight of that day |
| UTC instant | `2026-06-20T17:00:00.000Z` | as given |
| zoned instant | `2026-06-20T17:00:00+02:00` | the equivalent UTC instant |

`null` clears the due date. A **bare local datetime with no zone**
(`2026-06-20T17:00:00`) is rejected with `422` because it's ambiguous — append
`Z` or an offset, or send the date-only form. The same contract applies
everywhere `dueDate` is accepted (`POST /tickets`, `PATCH /tickets/{id}`,
`POST /inbox/{noteId}/sort`).

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

### Notes (full management)

The inbox above is the read-and-file queue for notes a human routed to *this*
agent. The endpoints below let an agent manage **all** notes across its
workspace — captured ideas before they become tickets. Every note belongs to a
workspace member; an agent only ever sees notes whose owner is in its workspace.

```
GET    /notes                  # list workspace notes (filterable)        scope: notes:read
POST   /notes                  # create a note (for a workspace user)      scope: notes:write
GET    /notes/{noteId}         # fetch one note                           scope: notes:read
PATCH  /notes/{noteId}         # edit body/pinned/status/bucket/priority   scope: notes:write
DELETE /notes/{noteId}         # delete a note                            scope: notes:write
POST   /notes/{noteId}/move    # move to a bucket + position              scope: notes:write
POST   /notes/{noteId}/queue   # queue the note to an agent to sort       scope: notes:write
POST   /notes/{noteId}/attachments  # attach audio/image/file (data URL)  scope: notes:write
```

**List** supports query filters (all optional, combinable):

| Param | Effect |
| --- | --- |
| `status` | `inbox` · `queued` · `sorting` · `sorted` · `archived` |
| `bucket` | `today` · `tomorrow` · `next_week` · `next_month` · `general` |
| `userId` | only notes owned by this workspace member |
| `assigned=me` | only notes currently queued to the calling agent |

```bash
curl "https://your-kanbai.app/api/v1/notes?status=inbox&bucket=today" \
  -H "Authorization: Bearer <TOKEN>"
# → { notes: [ { id, body, status, bucket, priority, suggestedDueDate, attachments, ... } ] }
```

**Create** a note. Owner resolution: `userId` or `userEmail` (must be a member
of this workspace), otherwise it defaults to the workspace owner.

```bash
curl -X POST https://your-kanbai.app/api/v1/notes \
  -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{ "body":"Draft Q3 roadmap", "bucket":"next_week", "priority":"high",
        "userEmail":"jo@example.com" }'
# → { note: { id, body, bucket, priority, ... } }
```

**Edit / move / queue / attach**

```bash
# Edit fields (any subset)
curl -X PATCH https://your-kanbai.app/api/v1/notes/note_123 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{ "priority":"urgent", "pinned":true }'

# Reorder within a bucket
curl -X POST https://your-kanbai.app/api/v1/notes/note_123/move \
  -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{ "bucket":"today", "position":0 }'

# Queue to an agent to sort (omit agentId to queue to yourself)
curl -X POST https://your-kanbai.app/api/v1/notes/note_123/queue \
  -H "Authorization: Bearer <TOKEN>" \
  -H "content-type: application/json" \
  -d '{ "agentId":"agt_hermes", "sortContext":"File under the product board" }'
```

A note queued this way fires the same `note.queued` webhook to the target agent,
which then files it with `POST /inbox/{noteId}/sort` exactly as above.

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

`note.queued` · `note.sorted` · `ticket.created` · `ticket.updated` ·
`ticket.moved` · `ticket.assigned` · `comment.created` · `ping`

- **`note.sorted`** fires to the agent a note was **queued to** once that note
  is filed into a ticket (by anyone — a human, that agent, or another agent).
  Use it to stop polling/churning on a note you received via `note.queued`. The
  payload carries the identifiers you need to reconcile:
  ```json
  { "event": "note.sorted",
    "data": { "note": { "id": "note_123", "status": "sorted" },
              "ticket": { "id": "tkt_456", "number": 12, "boardId": "brd_1", "title": "…" } } }
  ```

#### Fan-out & self-events

Workspace events (`ticket.*`, `comment.created`) are broadcast to every active
agent with a webhook **except the agent that caused the event** — you never
receive an echo of your own writes, so an agent can't loop on its own changes.
Targeted events (`note.queued`, `note.sorted`, `ticket.assigned`) go only to the
relevant agent, and are likewise suppressed when that agent is itself the actor.
Subscribe to the event types you care about and ignore the rest — every event is
typed via `X-Kanbai-Event` and the `event` field for easy filtering.

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

> **Sign the raw body — not re-serialized JSON.** `rawBody` is the exact byte
> string Kanbai sent, character-for-character. You **must** capture the raw
> request body *before* any JSON parsing and HMAC **that**. Parsing then
> re-stringifying (`JSON.stringify(JSON.parse(body))`) reorders keys and changes
> whitespace, so the HMAC won't match and verification will fail. In Express use
> `express.raw()` (or `req.rawBody`); in Next.js route handlers use
> `await req.text()`; in frameworks that auto-parse, configure a raw-body hook.

The agent must:
1. Capture the **raw request body** (bytes/string as received, pre-parse).
2. Recompute the HMAC over `` `${timestamp}.${rawRequestBody}` ``.
3. Compare in **constant time** to the signature header.
4. Reject if the timestamp is older than ~5 minutes (replay protection).

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
agent.

### Delivery & retries

Each delivery is attempted up to **3 times** with linear backoff (~0.4s, then
~0.8s), and times out after 8s per attempt. What gets retried is decided by the
response:

| Outcome | Retried? |
| --- | --- |
| `2xx` | — (success) |
| Timeout / connection error | ✅ yes |
| `429`, any `5xx` | ✅ yes (transient) |
| `400`, `401`, `403`, `404`, `422` (and other `4xx`) | ❌ no — terminal |

A terminal `4xx` means the request itself is unacceptable (bad signature config,
auth, validation) and won't succeed on replay, so Kanbai stops immediately and
records the delivery as `failed`. **Return `2xx` quickly** once you've verified
the signature and accepted the event (idempotently, keyed on
`X-Kanbai-Delivery`); do heavy work asynchronously. Returning a `4xx` for a
transient problem will drop the event with no retry.

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
