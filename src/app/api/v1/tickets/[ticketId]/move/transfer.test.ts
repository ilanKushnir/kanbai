import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { POST as MOVE } from "./route";
import { GET } from "../route";

// Cross-board move: POST /tickets/{id}/move { boardId } keeps the ticket (id,
// comments, subtasks), renumbers it on the target, carries labels by name,
// lands in the same-stage column and logs ticket.transferred.

const KEY = "kbai_live_transfer_key_0000000000000000";
let ticketId: string;
let fromId: string;
let toId: string;
let toBacklogId: string;
let otherWsBoardId: string;

function req(path: string, body?: unknown) {
  return new Request(`http://test.local/api/v1/tickets${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ ticketId: id }) });

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.comment.deleteMany();
  await db.subtask.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.agent.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

const COLS = [
  { name: "Ideas", position: 0, stage: "intake" },
  { name: "Backlog", position: 1, stage: "backlog" },
  { name: "Done", position: 2, stage: "done", isDone: true },
];

before(async () => {
  await wipe();
  const owner = await db.user.create({ data: { email: "o@transfer.test", name: "Owner" } });
  const ws = await db.workspace.create({ data: { name: "T", slug: "t-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } } });
  const other = await db.workspace.create({ data: { name: "O", slug: "o-ws" } });
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "tickets:read,tickets:write" } });
  const from = await db.board.create({ data: { workspaceId: ws.id, name: "General", slug: "general", columns: { create: COLS } }, include: { columns: true } });
  const to = await db.board.create({ data: { workspaceId: ws.id, name: "Family", slug: "family", columns: { create: COLS } }, include: { columns: true } });
  const ob = await db.board.create({ data: { workspaceId: other.id, name: "Elsewhere", slug: "elsewhere", columns: { create: COLS } } });
  fromId = from.id;
  toId = to.id;
  otherWsBoardId = ob.id;
  toBacklogId = to.columns.find((c) => c.name === "Backlog")!.id;
  // An existing ticket on the target so the moved one must be renumbered.
  await db.ticket.create({ data: { boardId: to.id, columnId: toBacklogId, title: "Already here", number: 1 } });
  const label = await db.label.create({ data: { boardId: from.id, name: "errand", color: "amber" } });
  const t = await db.ticket.create({
    data: {
      boardId: from.id,
      columnId: from.columns.find((c) => c.name === "Backlog")!.id,
      title: "הזמנת בשר",
      number: 4,
      dueDate: new Date("2030-01-01T10:00:00Z"),
      labels: { create: { labelId: label.id } },
      comments: { create: { body: "keep me", authorType: "user", authorName: "Owner" } },
      subtasks: { create: { title: "call butcher" } },
    },
  });
  ticketId = t.id;
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("moves to another board in one call, keeping everything", async () => {
  const res = await MOVE(req(`/${ticketId}/move`, { boardId: toId }), ctx(ticketId));
  assert.equal(res.status, 200, await res.clone().text());
  const { ticket } = await res.json();
  assert.equal(ticket.id, ticketId);
  assert.equal(ticket.boardId, toId);
  assert.equal(ticket.columnId, toBacklogId); // same stage (backlog)
  assert.equal(ticket.number, 2);
  assert.deepEqual(ticket.labels.map((l: { name: string }) => l.name), ["errand"]);
  const label = await db.label.findFirstOrThrow({ where: { boardId: toId, name: "errand" } });
  assert.equal(ticket.labels[0].id, label.id);

  const full = await (await GET(req(`/${ticketId}`), ctx(ticketId))).json();
  assert.equal(full.ticket.comments.length, 1);
  assert.equal(full.ticket.subtasks.length, 1);
  assert.equal(full.ticket.dueDate, "2030-01-01T10:00:00.000Z");
  const log = await db.activityLog.findFirstOrThrow({ where: { action: "ticket.transferred" } });
  assert.equal(log.boardId, toId);
  assert.equal(JSON.parse(log.meta!).fromBoard, "General");
});

test("target column by stage; foreign board is 404; boardId-only body validates", async () => {
  const res = await MOVE(req(`/${ticketId}/move`, { boardId: fromId, stage: "done" }), ctx(ticketId));
  assert.equal(res.status, 200);
  const { ticket } = await res.json();
  assert.equal(ticket.boardId, fromId);
  assert.equal(ticket.isDone, true);
  assert.ok(ticket.completedAt);
  assert.equal((await MOVE(req(`/${ticketId}/move`, { boardId: otherWsBoardId }), ctx(ticketId))).status, 404);
});
