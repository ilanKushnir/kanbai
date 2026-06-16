<div align="center">
  <img src="./public/icon.svg" width="84" height="84" alt="Kanbai logo" />
  <h1>Kanbai</h1>
  <p><strong>Capture fast. Let agents sort. Keep serious Kanban when it counts.</strong></p>
  <p>The bridge between fast human capture and serious agentic execution.</p>
</div>

---

Kanbai closes the gap between how humans capture work (a line here, a voice memo
there) and where serious work actually lives (structured boards). You jot scraps
on the go; an **AI agent** turns them into well-formed tickets on the right board
— with a priority, labels, and a due date — while you keep full control.

Three surfaces, one brain:

- **📝 Notes (mobile-first)** — Apple-Notes-fast capture. Swipe a scrap →
  *Send to an agent to sort*, optionally with a typed instruction or a **voice memo**.
- **📋 Boards (desktop-serious)** — real Kanban: drag-and-drop columns, priorities,
  labels, due dates, assignees (human *or* agent), comments, activity.
- **🤖 Agents (the connective tissue)** — Hermes, Open Claw, Claude Code, Codex,
  or any custom agent. They authenticate with a key and verify a **signed webhook**.

## Why it's different

Most tools make you choose: a frictionless notes app *or* a heavyweight project
tool. Kanbai is both, joined by agents. The agent does the tedious part —
**triage and filing** — so capture stays instant and the board stays trustworthy.

## Features

- Drag-and-drop Kanban with optimistic updates (dnd-kit), keyboard & touch support
- Fast notes capture with pin / archive / inline edit and a one-tap **Sort** flow
- Voice-memo recording attached to the sort request
- Secure agent API (`/api/v1`) with scoped, hashed **Bearer keys**
- **HMAC-SHA256 signed webhooks** with timestamp replay protection + delivery log
- Human-or-agent assignees, labels, priorities, due dates, comments, activity log
- Polished, minimalist UI with light/dark themes and a responsive shell
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
human captures a note → "Sort" → agent receives note.queued (signed)
   → agent reads /api/v1/inbox → POST /api/v1/inbox/{id}/sort
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
