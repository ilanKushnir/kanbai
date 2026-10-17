# Kanbai Agent Protocol

Kanbai is the single source of truth for tasks. An AI agent (Hermes, Claude Code,
Codex, …) drives it **only** through the REST API under `/api/v1` with a
Bearer key. There are no callbacks: when the agent wants to know the state of
the day, it asks. Every write is logged to the activity feed under the agent's
name and is undoable from the UI (snapshots, 30-day trash, archive-not-delete).

Base URL: `http://<kanbai-host>:3000/api/v1` (prefer the LAN address). All
bodies are JSON. Error shape: `{ "error": { "message", "code" } }` with the
usual statuses (400 bad JSON · 401 bad key · 403 disabled/missing scope ·
404 not in your workspace/access · 409 conflict · 422 validation, see `message`).

## 0. Simple task or ticket? Decide before every write

Kanbai has exactly two kinds of work item. Pick one every time the owner says
"add a task", "remind me to…", "I need to…", "put … on my list":

| | **Simple task** (`POST /tasks`) | **Ticket** (`POST /tickets`) |
|---|---|---|
| What | A plain to-do on the owner's Today list | A card on a project board |
| Use for | Errands, chores, calls, purchases, appointments, one-off reminders — anything that isn't part of a project | Work that belongs to a specific project / board: build, design, fix, research for that project |
| Examples | "order meat", "call the bank", "buy a birthday gift", "book a haircut", "pay the electricity bill" | "design an LED add-on for the server rack" (→ the rack project's board), "fix the login bug" (→ the app's board), "research flooring options" (→ the home-renovation board) |
| Where | Today (default) or the day the owner named | The board of that project, in its backlog unless told otherwise |

Rules:

1. **Default to a simple task.** If the request names no project and doesn't
   clearly belong to one of the boards, it is a simple task — *never* a
   ticket on a catch-all board (e.g. a "General" or "Personal" board). Short
   everyday chores are always simple tasks.
2. **A ticket only when it maps to a project.** It mentions a project/board by
   name or is obviously work on one (`GET /boards` once per session and match
   on board names and descriptions). Put it on *that* board. If two boards
   fit equally well, ask which one.
3. **Day.** Simple tasks go on **today** unless the owner named a day
   ("tomorrow", "on Thursday", "next week" → that date) or said "someday" / "no
   date" (→ `"day":"someday"`, the Inbox). Tickets get a `dueDate` only when
   the owner gave one.
4. **The owner said where.** "Add to the X board" → ticket on X. "Just a
   to-do", "on my today list" → simple task. Their words win over these rules.
5. Then tell the owner what you did, in the format of §10.

## 1. Auth and `/me`

```
Authorization: Bearer kbai_live_…
```

**Getting the key.** The owner pastes a *connect brief* (Agents → Connect) into
the agent's chat. It carries a one-time code, never the key:

```
POST /connect  { "code": "kbc_…" }      (no auth — the code is the credential)
→ { apiKey, baseUrl, publicBaseUrl, skillUrl, agent, storeAs, next }
```

Store `apiKey` and `baseUrl` (as `KANBAI_API_KEY` / `KANBAI_URL`) in your secret
store straight from the response. Codes live 24 h and die 10 minutes after the
first redemption; every redemption mints a new key (keep the last). The current
key keeps working until a code is redeemed. `baseUrl` may be a direct/LAN origin
(`KANBAI_AGENT_URL`); `publicBaseUrl` is the public one — send a normal
`User-Agent` there, CDN bot filters answer bare clients with 403 "error 1010".
This document is also served as an installable skill at `GET /skill.md`.

Scopes: `boards:read|write`, `tickets:read|write`, `inbox:read|write`,
`notes:read|write` (also covers `/tasks`), `comments:write`,
`members:read|write`. New agents get all.

```
GET /me   →  { service:{name,version}, apiVersion, baseUrl, agent, workspaceId,
               ownerUserId, scopes, capabilities:{ agenda:true, ticketsList:true, … },
               conventions:{ priorities, columnStages, dueDateFormats, timezone,
                             descriptionFormat:"markdown", descriptionAllowedTags },
               quickstart:[ curl one-liners ] }
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

## 3. Simple tasks (`/tasks`)

The owner's plain to-dos — what they see under "Add a task" on Today. No board,
no columns: a title, a day, done or not. (Under the hood these are notes, §6;
`/tasks` is the simpler vocabulary — use it.)

```
GET    /tasks?day=all|today|tomorrow|someday|YYYY-MM-DD&status=open|done|all   notes:read
                                         default: every day, open only
POST   /tasks              { title, day?, priority? }      → 201 { task }        notes:write
GET    /tasks/{id}                                          → { task }
PATCH  /tasks/{id}         { title?, day?, done?, priority? } → { task }
POST   /tasks/{id}/done                                     → { task }  (completes it today)
DELETE /tasks/{id}         soft-delete → trash, restorable 30 days
```

`day`: `"today"` (the default), `"tomorrow"`, `"YYYY-MM-DD"`, or `"someday"` /
`null` for no day (the Inbox). `PATCH {"done": false}` reopens. A task object:
`{ id, kind:"task", title, day, done, doneOn, priority, ticket, createdAt, updatedAt }`
(`ticket` is set once it was promoted to a board, §6).

```bash
curl -X POST $BASE/tasks -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{"title":"Order meat"}'                            # today
curl -X POST $BASE/tasks -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{"title":"Call the bank","day":"2026-10-20"}'      # a named day
```

Open tasks also appear in `GET /today` as `notesToday` (due today or earlier)
and `inbox` (no day).

## 4. Boards and columns

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

## 5. Tickets

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
  "dueDate": "2026-10-20",        // see §8; null = none
  "description": "Bring **two** photos.\n\n- [ ] Book slot\n- [ ] Pay fee",
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

**Move to another board** — the same call with `boardId`:
`POST /tickets/{id}/move { "boardId": "<target>" }` (optionally plus `column` /
`stage`; default: the column with the same stage, else the first). One atomic
move: the ticket keeps its id, comments, subtasks, history, due date and
priority; it gets the target board's next `number`; labels are re-created there
by name; human assignees without access to the target board are unassigned.
Logs `ticket.transferred`. Never emulate it with create + delete.
Landing in a done column stamps `completedAt` and logs `ticket.done`; leaving
one clears it (`ticket.reopened`). `POST /tickets/{id}/done` is the shortcut.

A ticket object: `id, number, boardId, columnId, column (name), title,
description (sanitized HTML), priority, subState, dueDate, completedAt, isDone,
assignee, assignees[], labels[], subtasks[], comments[], commentCount,
sourceNoteId, createdAt, updatedAt`.

## 6. Notes and the inbox

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
fields of §5 (`boardId` required; `title` defaults to the note's first line;
`column`/`columnName`/`stage`, `labelNames`, `dueDate`, `priority` all work) and
returns `{ ticket, note:{id,status:"sorted"} }`. The note is linked to the
ticket and hidden from the inbox but never deleted.
Never emulate this with create-ticket + delete-note.

## 7. Trash (30-day restore)

```
GET  /trash                                   { notes:[…], tickets:[…], retentionDays:30 }
POST /trash  { action:"restore", type:"note"|"ticket", id }
```

Soft-deleted notes/tickets sit here for 30 days. Agents can restore; permanent
purge is human-only.

## 8. Conventions

- **Priorities:** `none | low | medium | high | urgent`.
- **dueDate:** `"YYYY-MM-DD"` (→ 12:00 in the workspace timezone), ISO with an
  offset (`2026-10-20T17:00:00+03:00`), or UTC (`…T14:00:00Z`). `null` clears.
  A bare local datetime without a zone is rejected (422). Responses always
  return a UTC instant.
- **Stages:** `intake | backlog | active | done`; `done` ⇔ `isDone`.
- **Description:** Markdown (GFM: headings, lists, `- [ ]` checklists, bold,
  links, code) — stored and returned as written, rendered formatted in the UI.
  Simple HTML (`p b i u h3 ul ol li blockquote a`) is still accepted and
  sanitized; older descriptions may come back as that HTML.
- **Column by name** is case-insensitive; a miss is `422 column_not_found` and
  the message lists the board's columns.
- **Timezone:** every "today" (agenda, `due=` filters, date-only due dates,
  note days) uses `KANBAI_TZ` (default `Asia/Jerusalem`) — never the server's.
- **Access:** an agent with an owner sees only that user's boards and notes; a
  workspace-wide agent sees everything. Out-of-scope ids are `404`.
- **Members:** `GET/POST /members`, `PATCH/DELETE /members/{userId}` (role and
  per-board access; the workspace owner can't be changed or removed).

## 9. Daily agent playbook

**Morning.** `GET /today`. Read `overdue` first, then `today`, `notesToday`
and `inbox`. Summarize for the owner in that order: what slipped, what is due, what
is captured but unplanned. Do not reschedule anything unasked. If the agenda
is empty, say so and offer `upcoming`.

**The owner dictates a task.** Decide simple task vs ticket (§0) first.

- Everyday to-do → one call, lands on Today:
  `POST /tasks {"title":"Order meat"}` (add `"day"` only if they named one).
- Project work → find its board (`GET /boards` once per session, cache
  `id`/`name`/`description`/columns), then
  `POST /tickets {"boardId":"<id>","title":"Design LED add-on","stage":"backlog"}`.

Dates in speech ("Thursday", "next week") become a `YYYY-MM-DD` in the
workspace timezone. Keep the owner's language in titles (Hebrew stays Hebrew).
Several items in one message → classify each one separately.

**Mark done.** Find it in the agenda you already hold, or search: simple
tasks with `GET /tasks?status=open`, tickets with `GET /tickets?q=dentist&status=open`.
Then `POST /tasks/{id}/done` or `POST /tickets/{id}/done`. Report what was closed.

**Planning ("plan my week", "what has no date?").** Undated work is
`GET /tasks?day=someday` (simple tasks) and `GET /tickets?status=open&due=none`
(tickets). Give each one a day only when the owner agrees: `PATCH /tasks/{id}
{"day":"YYYY-MM-DD"}` / `PATCH /tickets/{id} {"dueDate":"YYYY-MM-DD"}`, then
the §10 receipt with 📅 lines. The owner sees the same picture in the app's
Plan calendar, where they drag tasks onto days themselves.

**Filed it in the wrong place?** A ticket that should have been a simple task:
`POST /tasks {"title":…}` then `DELETE /tickets/{id}` (restorable 30 days). A
simple task that turned out to be project work: `POST /notes/{id}/promote
{"boardId":…}` (the task id is the note id).

**Move between boards.** `POST /tickets/{id}/move {"boardId":"<target>"}` — one
call, nothing lost (§5). Within a board use `POST /tickets/{id}/move {"column":"In Work"}`.

**Create a project board.** `POST /boards {"name":"Kitchen reno",
"columns":[{"name":"Ideas","stage":"intake"},{"name":"Next","stage":"backlog"},
{"name":"Doing","stage":"active"},{"name":"Done","stage":"done"}]}`, then add
the tickets the owner lists with `"stage":"backlog"`. Retire a finished project with
`DELETE /boards/{id}` (archive).

**Comments.** Progress, context, links: `POST /tickets/{id}/comments
{"content":"…"}`. Never edit a title to add status.

**Rules.** Prefer the smallest write that expresses the intent. Never delete
boards or purge trash. When a column or board name doesn't match, read the 422
message (it lists the valid names) and ask rather than guessing. All your
actions appear in the Activity feed under your agent name, so keep them deliberate.

## 10. Reporting back to the owner

After every write (add, complete, move, reschedule, edit, delete), reply with
a short receipt — **one line per item**, emoji first, nothing else. The owner
should see at a glance what changed and where.

| Emoji | Meaning | Line |
|---|---|---|
| ➕ | simple task added | `➕ Today · Order meat` / `➕ Thu 22 Oct · Call the bank` / `➕ Someday · Read the manual` |
| 📋 | ticket added | `📋 Rack project › Backlog · #42 Design LED add-on` |
| ✅ | completed | `✅ Order meat` / `✅ #17 Fix login bug` |
| ↩️ | reopened | `↩️ #17 Fix login bug` |
| 📅 | rescheduled / due date | `📅 Call the bank → Sun 25 Oct` |
| 🔀 | moved | `🔀 #17 Fix login bug → In Work` / `🔀 #4 Order meat · General → Family` |
| ✏️ | edited | `✏️ #42 Design LED add-on · priority high` |
| 💬 | commented | `💬 #42 Design LED add-on` |
| 🗑️ | deleted (restorable 30 days) | `🗑️ Old errand` |
| ⚠️ | failed / needs the owner | `⚠️ No board for "garden" — which one?` |

Rules:

- Write in the owner's language; keep task titles exactly as saved (Hebrew
  stays Hebrew). Dates as a short weekday + day + month in their language.
- Several actions → one line each, in the order done, grouped by emoji. Over
  ~8 lines, summarize the rest (`…and 6 more ✅`).
- **Bold** the task title only if the chat renders Markdown; otherwise plain.
- No preamble ("Sure!", "I've gone ahead and…"), no API talk, no ids, no
  "let me know if…". If something was ambiguous, one ⚠️ line with the question.
- Reads (agenda, "what's on today") are not receipts — answer those normally,
  short, overdue first.

Example — "add order meat, and for the rack project an LED add-on, and close
the dentist":

```
➕ Today · Order meat
📋 Rack project › Backlog · #42 LED add-on
✅ Call the dentist
```
