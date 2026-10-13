# Kanbai Agent Protocol

Kanbai is the single source of truth for tasks. An AI agent (Astra, Hermes,
Claude Code, …) drives it **only** through the REST API under `/api/v1` with a
Bearer key. There are no callbacks: when the agent wants to know the state of
the day, it asks. Every write is logged to the activity feed under the agent's
name and is undoable from the UI (snapshots, 30-day trash, archive-not-delete).

Base URL: `http://<kanbai-host>:3000/api/v1` (prefer the LAN address). All
bodies are JSON. Error shape: `{ "error": { "message", "code" } }` with the
usual statuses (400 bad JSON · 401 bad key · 403 disabled/missing scope ·
404 not in your workspace/access · 409 conflict · 422 validation, see `message`).

## 1. Auth and `/me`

```
Authorization: Bearer kbai_live_…        # created in Agents → Add agent (shown once)
```

Scopes: `boards:read|write`, `tickets:read|write`, `inbox:read|write`,
`notes:read|write`, `comments:write`, `members:read|write`. New agents get all.

```
GET /me   →  { service:{name,version}, apiVersion, baseUrl, agent, workspaceId,
               ownerUserId, scopes, capabilities:{ agenda:true, ticketsList:true, … },
               conventions:{ priorities, columnStages, dueDateFormats, timezone,
                             descriptionFormat:"html", descriptionAllowedTags },
               quickstart:[ five curl one-liners ] }
```

Call it once on connect. `ownerUserId` is the person you act for (their boards
and notes are what you see); `conventions.timezone` is the zone every "today"
is computed in (`KANBAI_TZ`, default `Asia/Jerusalem`).

## 2. `/today` — the day in one call

```
GET /today[?scope=all|mine]       scope: tickets:read
→ {
  "date": "2026-10-13", "timezone": "Asia/Jerusalem",
  "overdue":  [Ticket], "today": [Ticket], "tomorrow": [Ticket],
  "upcoming": [Ticket],                    // due in the next 7 days, after tomorrow
  "inbox":    [Note],                      // open, unscheduled notes
  "notesToday": [Note],                    // scheduledDay <= today, not done
  "doneToday": { "tickets": [Ticket], "notes": [Note] }
}
```

Tickets here (and in `GET /tickets`) are the normal ticket object **plus**
`board: {id,name,slug,color,doneColumnId}` and `column: {id,name,isDone,stage}`
(`columnName` is the plain name). Lists are sorted soonest-due first, then
priority. `scope=mine` keeps only tickets assigned to the owner; the default
`all` is every ticket on the boards you can see. Day boundaries follow the
workspace timezone, so a ticket due `23:30` Jerusalem time is still "today".

## 3. Boards and columns

```
GET    /boards[?archived=true]                 list (columns, labels, ticketCount)   boards:read
GET    /boards/{boardId}                       board with every column + ticket      boards:read
POST   /boards                                 { name, description?, color?,          boards:write
                                                 columns?:[{name,stage?|isDone?}], labels?:[{name,color?}] }
PATCH  /boards/{boardId}                       { name?, description?, color?, archived? }
DELETE /boards/{boardId}                       archives (soft) → { ok, archived:true, board }
GET    /boards/{boardId}/columns               ordered columns
POST   /boards/{boardId}/columns               { name, stage? | isDone? }
PATCH  /boards/{boardId}/columns/{columnId}    { name?, stage?, isDone?, wipLimit?, subStates? }
DELETE /boards/{boardId}/columns/{columnId}    only when EMPTY (422 column_not_empty otherwise)
POST   /boards/{boardId}/columns/reorder       { orderedIds:[every column id once] }
```

Boards are never destroyed by agents: `DELETE` and `{ archived: true }` are the
same reversible archive; `PATCH { archived: false }` brings everything back.
A new board gets `Ideas / Backlog / In Work / Done` unless you pass `columns`.
Column **stages** are semantic: `intake` (Ideas) · `backlog` · `active` (In
Work) · `done` (implies `isDone`). Address a column anywhere by `columnId`, by
name (`column` / `columnName`, case-insensitive) or by `stage`.

## 4. Tickets

```
GET    /tickets?boardId=&status=open|done|all&due=overdue|today|tomorrow|week|none|any
               &assigned=me|any|unassigned|<userId>&q=<title substring>&limit=200   tickets:read
POST   /tickets                                create                                   tickets:write
GET    /tickets/{id}                           read (comments, subtasks, labels inline)  tickets:read
PATCH  /tickets/{id}                           update any field, move, relabel           tickets:write
POST   /tickets/{id}/move                      { columnId | column | stage, position?, subState? }
POST   /tickets/{id}/done                      straight to the board's done column
DELETE /tickets/{id}                           soft-delete → trash, restorable 30 days
POST   /tickets/{id}/comments                  { body } or { content }                   comments:write
GET    /tickets/{id}/subtasks                  checklist                                 tickets:read
POST   /tickets/{id}/subtasks                  { title }           → { subtask, ticket } tickets:write
PATCH  /tickets/{id}/subtasks/{subId}          { title?, completed? } → { subtask, ticket }
DELETE /tickets/{id}/subtasks/{subId}          → { ok, subtask, ticket }
POST   /tickets/{id}/subtasks/reorder          { orderedIds } → { subtask:null, ticket }
```

**Create** (`boardId` + `title` are the only required fields):

```json
{ "boardId": "…", "title": "Renew passport",
  "column": "Backlog",            // or "columnId": "…" or "stage": "backlog"; default: first column
  "priority": "high",             // none | low | medium | high | urgent (default medium)
  "dueDate": "2026-10-20",        // see §7; null = none
  "description": "<p>Bring two photos.</p>",
  "labelNames": ["errand"],       // created on the board if missing (or "labelIds")
  "assigneeUserId": "…" }         // or "assigneeEmail" / "assigneeAgentId"; default: unassigned
→ 201 { "ticket": {...} }
```

**Update** — `PATCH /tickets/{id}` takes any subset of the create fields plus
`subState`, `position`, `assigneeType` (`null` unassigns), `assigneeUserIds`.
`column` / `stage` / `columnId` on a PATCH move the ticket (end of the target).
`labelNames` **replaces** the whole label set. `dueDate: null` clears it.

**Move** — `POST /tickets/{id}/move { "stage": "done" }` or
`{ "column": "In Work", "position": 0 }`. `position` defaults to the end.
Landing in a done column stamps `completedAt` and logs `ticket.done`; leaving
one clears it (`ticket.reopened`). `POST /tickets/{id}/done` is the shortcut.

A ticket object: `id, number, boardId, columnId, column (name), title,
description (sanitized HTML), priority, subState, dueDate, completedAt, isDone,
assignee, assignees[], labels[], subtasks[], comments[], commentCount,
sourceNoteId, createdAt, updatedAt`.

## 5. Notes and the inbox

Notes are the owner's quick captures (one line each). They live on a local
calendar day (`scheduledDay: "YYYY-MM-DD"`, `null` = unscheduled "General") and
carry `doneOn` (day completed, `null` = open), `priority`, `pinned`, `status`
(`inbox | queued | sorted | archived`) and `suggestedDueDate`.

```
GET    /notes?status=&bucket=&userId=&assigned=me     notes:read   (never shows deleted notes)
POST   /notes            { body, scheduledDay? | bucket?, priority?, userId?|userEmail? }   notes:write
GET    /notes/{id}
PATCH  /notes/{id}       { body?, scheduledDay?, doneOn?, priority?, pinned?, status?:"inbox"|"archived" }
DELETE /notes/{id}       soft-delete → trash
POST   /notes/{id}/move  { scheduledDay, position }
POST   /notes/{id}/queue { agentId?, sortContext? }   hand a note to an agent to sort
POST   /notes/{id}/promote   note → ticket in ONE atomic action (any note)   notes:write + tickets:write
GET    /inbox            notes queued to YOU (status "queued")             inbox:read
POST   /inbox/{id}/sort  same body as promote, for a note queued to you     inbox:write
```

Mark a note done: `PATCH /notes/{id} {"doneOn":"2026-07-14"}` (logs
`note.done`); `{"doneOn": null}` reopens it. **Promote** takes the ticket
fields of §4 (`boardId` required; `title` defaults to the note's first line;
`column`/`columnName`/`stage`, `labelNames`, `dueDate`, `priority` all work) and
returns `{ ticket, note:{id,status:"sorted"} }`. The note is linked to the
ticket and hidden from the inbox but never deleted.
Never emulate this with create-ticket + delete-note.

## 6. Trash (30-day restore)

```
GET  /trash                                   { notes:[…], tickets:[…], retentionDays:30 }
POST /trash  { action:"restore", type:"note"|"ticket", id }
```

Soft-deleted notes/tickets sit here for 30 days. Agents can restore; permanent
purge is human-only.

## 7. Conventions

- **Priorities:** `none | low | medium | high | urgent`.
- **dueDate:** `"YYYY-MM-DD"` (→ 12:00 in the workspace timezone), ISO with an
  offset (`2026-10-20T17:00:00+03:00`), or UTC (`…T14:00:00Z`). `null` clears.
  A bare local datetime without a zone is rejected (422). Responses always
  return a UTC instant.
- **Stages:** `intake | backlog | active | done`; `done` ⇔ `isDone`.
- **Description:** simple HTML — `p b i u h3 ul ol li blockquote a` (sanitized;
  plain text is fine). Not Markdown.
- **Column by name** is case-insensitive; a miss is `422 column_not_found` and
  the message lists the board's columns.
- **Timezone:** every "today" (agenda, `due=` filters, date-only due dates,
  note days) uses `KANBAI_TZ` (default `Asia/Jerusalem`) — never the server's.
- **Access:** an agent with an owner sees only that user's boards and notes; a
  workspace-wide agent sees everything. Out-of-scope ids are `404`.
- **Members:** `GET/POST /members`, `PATCH/DELETE /members/{userId}` (role and
  per-board access; the workspace owner can't be changed or removed).

## 8. Daily agent playbook (Astra)

**Morning.** `GET /today`. Read `overdue` first, then `today`, `notesToday`
and `inbox`. Summarize for Ilan in that order: what slipped, what is due, what
is captured but unplanned. Do not reschedule anything unasked. If the agenda
is empty, say so and offer `upcoming`.

**Ilan dictates a task.** Pick the board (`GET /boards` once per session and
cache `id`/`name`/columns; "personal", "home", "work" map to board names).
Then one call:

```bash
curl -X POST $BASE/tickets -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{"boardId":"<id>","title":"Call the dentist","column":"Backlog","priority":"medium","dueDate":"2026-10-15"}'
```

Dates in speech ("Thursday", "next week") become a `YYYY-MM-DD` in the
workspace timezone; no date → omit `dueDate`. A quick thought with no board is a
note: `POST /notes {"body":"…"}` (optionally `scheduledDay`). Confirm with the
ticket `number` and board name.

**Mark done.** Find it (`GET /tickets?q=dentist&status=open`, or from the
agenda you already hold), then `POST /tickets/{id}/done`. For a note:
`PATCH /notes/{id} {"doneOn":"<today>"}`. Report what was closed.

**Move between boards.** Tickets belong to one board; "move" across boards is
create-on-target + `DELETE` the original (it stays restorable 30 days). Say so.
Within a board use `POST /tickets/{id}/move {"column":"In Work"}`.

**Create a project board.** `POST /boards {"name":"Kitchen reno",
"columns":[{"name":"Ideas","stage":"intake"},{"name":"Next","stage":"backlog"},
{"name":"Doing","stage":"active"},{"name":"Done","stage":"done"}]}`, then add
the tickets Ilan lists with `"stage":"backlog"`. Retire a finished project with
`DELETE /boards/{id}` (archive).

**Comments.** Progress, context, links: `POST /tickets/{id}/comments
{"content":"…"}`. Never edit a title to add status.

**Rules.** Prefer the smallest write that expresses the intent. Never delete
boards or purge trash. When a column or board name doesn't match, read the 422
message (it lists the valid names) and ask rather than guessing. All your
actions appear in the Activity feed as "Astra", so keep them deliberate.
