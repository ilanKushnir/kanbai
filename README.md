<div align="center">
  <img src="./public/icon-512.png" width="84" height="84" alt="Kanbai logo" />
  <h1>Kanbai</h1>
  <p><strong>Your day, one list. Projects on boards. An agent that keeps it current.</strong></p>
  <p><sub><strong>Self-hosted</strong> · open source (MIT) · Docker-ready · Next.js + Prisma</sub></p>
</div>

---

Kanbai is a calm place for one person's work. You open **Today** and see what
is overdue, what is due, what is coming, and what you captured but haven't
placed yet — notes and board tickets in one list, one checkbox each. Projects
live on **Boards** (real Kanban). An **AI agent** (Hermes, Claude Code, Codex,
…) talks to Kanbai over a plain REST API: it reads your day, adds what you
dictate, moves things along and marks them done — and everything it does is
listed under its name. Kanbai is the source of truth; agents pull, Kanbai never
calls them back.

## The three surfaces

- **☀️ Today** — the only page you need in the morning. Quick-add understands
  dates, priority and boards in English and Hebrew (`Call the bank tomorrow
  !high #Personal`, `לקבוע תור לרופא מחר`), with server-side Whisper dictation.
  Sections: Overdue · Today · Tomorrow · This week · Later · Inbox · Done today.
  Tickets with a due date show up here automatically; a note becomes a board
  ticket with one menu action.
- **📋 Boards** — one board per project: columns with semantic stages
  (Ideas / Backlog / In Work / Done), drag-and-drop, sub-states, WIP limits,
  labels, priorities, due dates, subtasks, comments, a week view, cover art,
  public read-only links.
- **✨ Agents** — mint a key, paste the brief, done. `GET /api/v1/today` gives
  the whole day in one call; `POST /tickets`, `/move {"stage":"done"}`,
  `/comments` do the rest. No webhooks, no signing secrets. An activity feed
  shows every agent action, and every write is undoable (snapshots, 30-day
  trash, archive-not-delete).

## Features

- Today list mixing notes and tickets, natural-language quick-add (EN/HE), undo
  on every completion, midnight rollover without a reload
- Drag-and-drop Kanban with optimistic updates (dnd-kit), keyboard & touch support
- Secure agent API (`/api/v1`) with scoped, hashed **Bearer keys**
- `GET /api/v1/today` — the whole day (overdue / today / tomorrow / upcoming,
  note inbox, done today) in one call, computed in the workspace timezone
- Forgiving writes: address columns by name or stage, labels by name, dates as
  `YYYY-MM-DD`; every agent action lands in the activity feed and is undoable
- Human-or-agent assignees, labels, priorities, due dates, comments, activity log
- Monochrome "Monolith" design — white paper and ink, one vermilion signal
  colour, light/dark themes, tight grotesk display type and paper-craft
  illustrations for heroes, board covers and empty states
- **Public, read-only board links** to share progress without a login
- Per-board ticket **#numbers**, WIP limits, custom columns
- SQLite for zero-config local dev; swap to Postgres for production

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Prisma 6 +
SQLite · dnd-kit · Zod · lucide-react.

## Getting started

> **Prereqs:** Node 20+ and npm.
>
> **Note:** avoid cloning into a cloud-synced folder (iCloud Drive, Dropbox) —
> background sync can corrupt `node_modules`. Use a local path.

```bash
git clone git@github.com:ilanKushnir/kanbai.git
cd kanbai

npm install
cp .env.example .env            # then edit if you like

npx prisma migrate dev          # create the SQLite db + schema
npm run db:seed                 # demo workspace, boards, notes, + a Hermes agent

npm run dev                     # http://localhost:3000
```

The seed prints a **Hermes API key** once — copy it to try the agent API:

```bash
curl http://localhost:3000/api/v1/me -H "Authorization: Bearer <key>"
```

You land on **Today** on every device.

## Self-host with Docker

Kanbai is **self-hosted and open source (MIT)** — perfect for a homelab. The
image bundles everything and stores SQLite on a named volume, so your data
survives restarts and rebuilds. No external database required.

```bash
# 1. Set a strong key pepper in docker-compose.yml (or an .env):
#    openssl rand -hex 32   →   KANBAI_KEY_PEPPER
# 2. Build & run:
docker compose up -d --build
# 3. Open http://<host>:3000
```

To load the demo data (boards, notes, a Hermes agent) on first boot, set
`KANBAI_SEED=true` in `docker-compose.yml` for the first `up`, then set it back
to `false`. The container runs `prisma migrate deploy` automatically on every
start, so upgrades just need a rebuilt image.

**Prebuilt image:** a GitHub Action publishes `ghcr.io/ilankushnir/kanbai:latest`
on every push to `main`. To skip local builds, swap `build: .` in
`docker-compose.yml` for `image: ghcr.io/ilankushnir/kanbai:latest` and run
`docker compose pull && docker compose up -d`.

Want a quick, no-Compose run:

```bash
docker build -t kanbai .
docker run -d -p 3000:3000 \
  -e DATABASE_URL="file:/app/data/kanbai.db" \
  -e KANBAI_KEY_PEPPER="$(openssl rand -hex 32)" \
  -v kanbai-data:/app/data \
  --name kanbai kanbai
```

**Prefer Postgres?** Set `provider = "postgresql"` in
[`prisma/schema.prisma`](prisma/schema.prisma), point `DATABASE_URL` at your
Postgres service, add it to `docker-compose.yml`, and re-run migrations.

## Accounts, roles & access

Kanbai has real authentication (DB-backed sessions, scrypt-hashed passwords — no
external auth service).

- **First run is open:** the very first account created at `/signup` becomes the
  **instance (system) admin** and owns a global control panel at **`/admin`**
  (every workspace, user, board). After that, **sign-up is invite-only**.
- **Accounts = workspaces.** Within one: **owner → admin → member**.
- **Invites** (Members → Invite) come in two kinds: *join this workspace* (as a
  member or admin) or *create their own account* (a separate workspace they own).
  Invite links work for 14 days and can be revoked.
- **Per-board access:** members only see the boards you grant them (view or edit);
  owners/admins see all boards in their workspace. Agent management is owner/admin
  only.
- **System admin** can disable users, grant/revoke instance admin, and delete
  workspaces from `/admin`.

The seed creates a demo system admin — **`you@kanbai.app` / `kanbai1234`** (printed
when you run `npm run db:seed`). For a fresh production deploy, skip the seed and
just open the app; you'll be sent to `/signup` to create your admin account.

## Connecting an agent

1. Go to **Agents → Add agent**, pick an owner (whose boards it may touch).
2. Copy the API key (shown once) and the agent brief.
3. The agent calls `GET /api/v1/me` — the badge turns **Active**. Done.

Full spec and a daily playbook: **[docs/AGENT_PROTOCOL.md](./docs/AGENT_PROTOCOL.md)**.

The core loop:

```
morning   → GET  /api/v1/today                     overdue / today / tomorrow / inbox
dictate   → POST /api/v1/tickets {"boardId","title","column":"Backlog","dueDate":"2026-10-20"}
done      → POST /api/v1/tickets/{id}/done
capture   → POST /api/v1/notes {"body":"…"}  …later  POST /api/v1/notes/{id}/promote
```

Set `KANBAI_TZ` (default `Asia/Jerusalem`) so "today" follows your calendar,
not the server's.

## Security model

- API keys are random, prefixed (`kbai_live_…`), and stored only as a **salted
  SHA-256 hash** — the plaintext is shown once.
- Keys are **scoped**; calls without the needed scope get `403`. An agent with
  an owner is capped to that user's boards and notes.
- Every resource is workspace-scoped; cross-workspace access returns `404`.
- Agents never hard-delete: boards archive, tickets/notes go to a 30-day trash,
  and the first agent write of a session takes a restorable snapshot.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:seed` | Seed demo data (prints a Hermes key) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Reset the database |

## Project structure

```
prisma/                 schema, migrations, seed
src/
  app/
    (app)/              app shell + boards / notes / agents pages
    api/                internal API (UI) + /api/v1 (agents)
  components/           brand, ui primitives, board, notes, agents
  lib/
    services/           tickets, notes, boards, agenda, activity-feed (shared business logic)
    crypto.ts           API-key hashing
    tz.ts               workspace-timezone calendar helpers
docs/AGENT_PROTOCOL.md  the agent integration spec + daily playbook
```

## Roadmap

Multi-user auth & roles · board templates · agent-proposed due dates · realtime
board updates (SSE) · object storage for attachments · Postgres deploy guide.

## License

MIT — see [LICENSE](./LICENSE).

---

<div align="center"><sub>powered by KWS</sub></div>
