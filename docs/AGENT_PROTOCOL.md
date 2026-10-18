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
5. **Steps are subtasks.** When a task or ticket has parts ("first get a SIM,
   then connect WhatsApp, then Home Assistant"), or breaking it down would
   help, send them as `subtasks` — an array of short titles — when you create
   it, or add them later (`POST …/subtasks`). Both kinds of item take them.
   **Never** write a checklist (`- [ ] …`) into a title or description: it
   shows up as raw text, not as subtasks.
6. Then tell the owner what you did, in the format of §10.

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

Scopes: `boards:read|write`, `tickets:read|write`,
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
POST   /tasks              { title, day?, priority?, subtasks? } → 201 { task }  notes:write
GET    /tasks/{id}                                          → { task }
PATCH  /tasks/{id}         { title?, day?, done?, priority?, completeSubtasks? } → { task }
POST   /tasks/{id}/done    { completeSubtasks? }            → { task }  (completes it today)
DELETE /tasks/{id}         soft-delete → trash, restorable 30 days
GET    /tasks/{id}/subtasks                                 → { subtasks }
POST   /tasks/{id}/subtasks             { title } | { titles:[…] } → 201 { subtasks (new), task }
PATCH  /tasks/{id}/subtasks/{subId}     { title?, completed? }     → { subtask, task }
DELETE /tasks/{id}/subtasks/{subId}                                → { ok, task }
```

`day`: `"today"` (the default), `"tomorrow"`, `"YYYY-MM-DD"`, or `"someday"` /
`null` for no day (the Inbox). `PATCH {"done": false}` reopens. A task object:
`{ id, kind:"task", title, day, done, doneOn, priority, subtasks, ticket, createdAt, updatedAt }`
(`ticket` is set once it was promoted to a board, §6). `subtasks` is the
task's checklist, in order: `[{ id, title, completed }]`.

**Subtasks.** Break a task into steps by passing `subtasks` (up to 50 short
titles) on create, or append with `POST /tasks/{id}/subtasks`. Tick one with
`PATCH …/subtasks/{subId} {"completed":true}`. Completing the task
(`/done`, or `PATCH {"done":true}`) also ticks its open subtasks — send
`"completeSubtasks": false` to leave them open. Promoting a task to a ticket
keeps its subtasks.

```bash
curl -X POST $BASE/tasks -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{"title":"Order meat"}'                            # today
curl -X POST $BASE/tasks -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{"title":"Call the bank","day":"2026-10-20"}'      # a named day
curl -X POST $BASE/tasks -H "Authorization: Bearer $KANBAI_KEY" -H "content-type: application/json" \
  -d '{"title":"Set up the new phone","subtasks":["Buy a SIM","Connect WhatsApp","Add to Home Assistant"]}'
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
POST   /tickets/{id}/done                      straight to the board's done column { completeSubtasks? }
DELETE /tickets/{id}                           soft-delete → trash, restorable 30 days
POST   /tickets/{id}/comments                  { body } or { content }                   comments:write
GET    /tickets/{id}/subtasks                  checklist                                 tickets:read
POST   /tickets/{id}/subtasks                  { title } | { titles:[…] } → { subtask, ticket } tickets:write
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
  "description": "Bring **two** photos.",
  "subtasks": ["Book a slot", "Pay the fee"],   // the checklist — never "- [ ]" in the description
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
Moving to done (either way) also completes the ticket's open subtasks; send
`"completeSubtasks": false` to leave them open.

A ticket object: `id, number, boardId, columnId, column (name), title,
description (sanitized HTML), priority, subState, dueDate, completedAt, isDone,
assignee, assignees[], labels[], subtasks[], comments[], commentCount,
sourceNoteId, createdAt, updatedAt`.

## 6. Notes (the storage behind simple tasks)

Notes are the owner's quick captures (one line each). They live on a local
calendar day (`scheduledDay: "YYYY-MM-DD"`, `null` = unscheduled "General") and
carry `doneOn` (day completed, `null` = open), `priority`, `pinned`, `status`
(`inbox` = an open task, `sorted` = promoted to a ticket, `archived`),
`subtasks` and `suggestedDueDate`. Prefer `/tasks` (§3) for everyday work.

```
GET    /notes?status=&bucket=&userId=     notes:read   (never shows deleted notes)
POST   /notes            { body, scheduledDay? | bucket?, priority?, userId?|userEmail? }   notes:write
GET    /notes/{id}
PATCH  /notes/{id}       { body?, scheduledDay?, doneOn?, priority?, pinned?, status?:"inbox"|"archived" }
DELETE /notes/{id}       soft-delete → trash
POST   /notes/{id}/move  { scheduledDay, position }
POST   /notes/{id}/promote   note → ticket in ONE atomic action (any note)   notes:write + tickets:write
```

Mark a note done: `PATCH /notes/{id} {"doneOn":"2026-07-14"}` (logs
`note.done`); `{"doneOn": null}` reopens it. **Promote** takes the ticket
fields of §5 (`boardId` required; `title` defaults to the note's first line;
`column`/`columnName`/`stage`, `labelNames`, `dueDate`, `priority` all work) and
returns `{ ticket, note:{id,status:"sorted"} }`. The note is linked to the
ticket and leaves Today, but is never deleted; its subtasks come along.
This is how to "turn a task into a ticket" when the owner asks.
Never emulate this with create-ticket + delete-note.

## 6b. Calendar (read-only)

```
GET /calendar[?day=today|tomorrow|YYYY-MM-DD | ?from=&to=]     notes:read
→ { connected, timezone, from, to, events:[{ title, allDay, start, end, day, endDay,
    location, calendar, startsAt }], errors:[{ calendar, message }] }
```

The owner's own calendars — the private iCal links they added in Kanbai →
Settings → Calendars (Google Calendar works). `start`/`end` are local
`"HH:MM"` in `timezone` (null for all-day); `startsAt` is the UTC instant.
Sorted all-day first, then by start. `connected: false` means no calendar is
linked **in Kanbai** — the owner may still have given you your own access to
their calendar (a calendar tool, MCP server or API of yours). Kanbai is one
source, not the only one. Read-only: never promise to create or move events.
Used by the daily brief (§11).

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
- **Description:** Markdown (GFM: headings, lists, bold, links, code) — stored
  and returned as written, rendered formatted in the UI. Steps belong in
  `subtasks`, not in a `- [ ]` list (a checklist sent on create is converted
  to subtasks).
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

**Morning.** Send the daily brief (§11) if the owner opted in; on "what's on
today?" send the same format. Do not reschedule anything unasked.

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
| ☑️ | subtasks added / ticked | `☑️ Set up the new phone · +3 subtasks` / `☑️ Buy a SIM (Set up the new phone)` |
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

## 11. The daily brief

A short morning message with what the owner has to do today — and, if they
want, what's on their calendar. Kanbai never sends anything itself: **you**
schedule it (your own cron / reminders / scheduler) and you send it.

### Offer it once, right after connecting

As soon as the connection works (and once more if the owner later asks about
it), ask **one** short message with all three questions, in the owner's
language.

Before asking, find out whether you can see their calendar at all. There are
two ways, and either one is enough:

- **Your own access** — a calendar tool, integration, MCP server or API the
  owner set up for you directly (Google Calendar, Outlook, CalDAV, …).
- **Through Kanbai** — `GET /calendar` returns `connected: true` (they added a
  calendar's iCal link in Kanbai → Settings → Calendars).

If you have either, offer the calendar question normally. Only if you have
**neither**, say so plainly, e.g. "I can't see your calendar yet — either give
me access to it directly, or add its iCal link in Kanbai → Settings →
Calendars", and still offer the tasks-only brief. Never say there's no
calendar access just because Kanbai's `connected` is false.

```
☀️ Want a daily brief from me?
Every morning: your tasks for the day, short and sorted.
1. Send it daily? (yes / no)
2. Add today's calendar events too? (yes / no)
3. What time? (e.g. 07:30)
```

Save the answers in **your own** memory/config (Kanbai doesn't store them),
set up the daily job at that time in the workspace timezone (`GET /me` →
`conventions.timezone`), and confirm in one line:
`✅ Daily brief set · every day at 07:30 · tasks + calendar`. The owner can
change or stop it any time by telling you ("brief at 8", "drop the calendar",
"stop the brief"). "Brief me" / "what's on today?" gets the same message on demand.

### Build it

1. `GET /today` — `overdue`, `today` (tickets), `notesToday` (simple tasks due
   today or earlier), `done` (finished today).
2. If they want the calendar, read today's events from whichever source you
   have — your own calendar access, or `GET /calendar` (today) →
   `events: [{ title, allDay, start, end, location, calendar }]`, times
   already local ("09:30"), all-day first, then by start. If both work, use
   one (prefer your direct access, it's usually fuller) and don't list an
   event twice. Show times in the workspace timezone.

### Format

```
☀️ Sunday, 18 Oct — 6 to do

⚠️ Overdue
• 📞 Call the bank · since Thu
• 🔧 #12 Fix the rack fan · KWS Rack

📋 Today
• 🛒 Order meat
• ❗ 💰 Pay the electricity bill
• 💻 #45 Rack utility site · KWS Rack · 1/3
• 🎂 Gift for Dana

🗓️ Calendar
• All day · Mom's birthday
• 09:30–10:00 · Standup
• 13:00–14:00 · Lunch with Yuval · Café Noir

🎯 Start with: Pay the electricity bill
```

Rules:

- **Order:** header → ⚠️ Overdue (only if any) → 📋 Today → 🗓️ Calendar (only
  if they opted in) → 🎯 one suggested first step. Leave out empty sections.
- **Header:** a weather-of-the-day emoji + weekday and date in their language +
  how many open items. ☀️ a normal day · 🔥 a heavy one (10+ items or 3+
  overdue) · 🌿 a light one (1–2) · 🌴 nothing to do · 🎉 Friday/weekend tone
  if that's the owner's weekend.
- **One line per item**, title exactly as saved (Hebrew stays Hebrew), then
  only what helps: a ticket's `#number` and board, `· done/total` when it has
  subtasks, `· since <day>` when overdue. No ids, no priorities spelled out —
  put ❗ in front of high/urgent items, and list those first.
- **A topical emoji per task**, picked from its title — that's what makes the
  brief scannable: 🛒 shopping · 📞 calls · 💰 bills/money · 📧 email/replies ·
  🏥 health · 💊 meds · 🚗 car · 🏠 home/chores · 🔧 fixing/hardware ·
  💻 code/computer · 📦 orders/deliveries · ✈️ travel · 🎂 birthdays ·
  👶 kids · 🐶 pets · 📚 reading/study · 🏋️ sport · 🍽️ food/cooking ·
  🗂️ paperwork · 🎨 design · 📝 anything else. Don't reuse the section emoji.
- **Calendar lines:** `All day · Title` first, then `HH:MM–HH:MM · Title`,
  `· place` only if there is one. Skip events that already ended when sending
  late. Don't invent events; if `errors` is not empty, add one line
  `⚠️ Couldn't read <calendar>`.
- **🎯 Start with:** the single most useful first item — overdue high priority,
  then today's high priority, then the first timed event that needs prep.
- **Long days:** at most 8 lines per section, then `…and 5 more`.
- **Empty day:** `🌴 Sunday, 18 Oct — nothing on your list today.` (plus the
  calendar if opted in). Never pad it with advice.
- Plain text with line breaks; **bold** only if the chat renders Markdown. No
  tables, no headings, no sign-off.
