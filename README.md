<div align="center">
  <img src="./public/icon.svg" width="84" height="84" alt="Kanbai logo" />
  <h1>Kanbai</h1>
  <p><strong>Capture fast. Let agents sort. Keep serious Kanban when it counts.</strong></p>
  <p>The bridge between fast human capture and serious agentic execution.</p>
  <p><sub><strong>Self-hosted</strong> · open source (MIT) · Docker-ready · Next.js + Prisma</sub></p>
</div>

---

Kanbai closes the gap between how humans capture work (a line here, a voice memo
there) and where serious work actually lives (structured boards). You jot scraps
on the go; an **AI agent** turns them into well-formed tickets on the right board
— with a priority, labels, and a due date — while you keep full control.

Three surfaces, one brain:

- **📝 Notes (mobile-first)** — Apple-Notes-fast capture, organised as one
  running note split into **when-buckets** (Today · Tomorrow · Next week · Next
  month · General). Drag a line to when it matters, set a priority, then **mark
  it for an agent** — it stays in place while the agent files it as a ticket
  (right board, due date, priority), optionally with a typed instruction or a
  **voice memo**.
- **📋 Boards (desktop-serious)** — real Kanban: drag-and-drop columns, priorities,
  labels, due dates, assignees (human *or* agent), comments, activity.
- **🤖 Agents (the connective tissue)** — Hermes, Open Claw, Claude Code, Codex,
  or any custom agent. They authenticate with a key and receive events via a
  webhook they self-register — **optionally signed** (HMAC, recommended).

## Why it's different

Most tools make you choose: a frictionless notes app *or* a heavyweight project
tool. Kanbai is both, joined by agents. The agent does the tedious part —
**triage and filing** — so capture stays instant and the board stays trustworthy.

## Features

- Drag-and-drop Kanban with optimistic updates (dnd-kit), keyboard & touch support
- Fast notes capture in draggable **when-buckets** with per-line priority, pin /
  archive / inline edit, and a one-tap **mark-for-ingestion** that an agent picks up
- Voice-memo recording attached to the sort request
- Secure agent API (`/api/v1`) with scoped, hashed **Bearer keys**
- Agent **self-registered webhooks** with **optional HMAC-SHA256 signing**
  (recommended), timestamp replay protection + delivery log
- Human-or-agent assignees, labels, priorities, due dates, comments, activity log
- Polished, minimalist UI with light/dark themes and a responsive shell
- **Public, read-only board links** to share progress without a login
- Per-board ticket **#numbers**, WIP limits, custom columns
- **Migrate from Kanboard** via the agent API (boards, columns, labels, tasks,
  members) — see [docs/AGENT_PROTOCOL.md](./docs/AGENT_PROTOCOL.md#6-migrating-from-kanboard)
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

On desktop you land on **Boards**; on mobile, on **Notes**.

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

1. Go to **Agents → Add agent** (Hermes is the recommended primary).
2. Copy the API key (shown once).
3. Set the agent's **webhook URL** (its own endpoint).
4. Set a **signing secret** — Kanbai signs every webhook with it so your agent can
   trust the payload. Hit **Send test** to verify.

Full spec, endpoints, and copy-paste verification code (Node & Python):
**[docs/AGENT_PROTOCOL.md](./docs/AGENT_PROTOCOL.md)**.

The core loop:

```
human captures a note → marks it for ingestion → agent receives note.queued (signed)
   → agent reads /api/v1/inbox (with bucket, priority & suggested due date)
   → POST /api/v1/inbox/{id}/sort
   → a real ticket appears on the right board, the note is marked sorted
```

You can verify the signing end-to-end with the included harness:

```bash
APP_URL=http://localhost:3000 npx tsx scripts/verify-webhook.ts
# → ✅ HMAC signature VERIFIED
```

## Security model

- API keys are random, prefixed (`kbai_live_…`), and stored only as a **salted
  SHA-256 hash** — the plaintext is shown once.
- Keys are **scoped**; calls without the needed scope get `403`.
- Outbound webhooks are signed `HMAC_SHA256(secret, "{timestamp}.{body}")` and
  verified in constant time with a ±5-minute replay window.
- Every resource is workspace-scoped; cross-workspace access returns `404`.

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
    services/           tickets, notes, boards, agents (shared business logic)
    crypto.ts           key hashing, HMAC signing/verification
    webhooks.ts         signed delivery + retries
docs/AGENT_PROTOCOL.md  the agent integration spec
scripts/verify-webhook.ts  end-to-end signature check harness
```

## Roadmap

Multi-user auth & roles · board templates · agent-proposed due dates · realtime
board updates (SSE) · object storage for attachments · Postgres deploy guide.

## License

MIT — see [LICENSE](./LICENSE).

---

<div align="center"><sub>powered by KWS</sub></div>
