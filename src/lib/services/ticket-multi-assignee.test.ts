import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { createTicket, updateTicket, moveTicket, type Actor } from "./tickets";

// Multi-assign: a ticket can carry several human assignees via assigneeUserIds
// while the legacy single-assignee pair keeps mirroring the first (primary)
// entry, so single-assignee clients and agents keep working. Also covers
// completedAt: stamped entering a done column, cleared on the way out.
// Runs against the throwaway SQLite db set up by the `test` script.

type Seed = {
  boardId: string;
  todoId: string;
  doneId: string;
  ilan: Actor;
  yuval: Actor;
  outsiderId: string;
  agentId: string;
};
let seed: Seed;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.ticketAssignee.deleteMany();
  await db.subtask.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.agent.deleteMany();
  await db.boardAccess.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const ws = await db.workspace.create({ data: { name: "Multi WS", slug: "multi-ws" } });
  const ilan = await db.user.create({ data: { email: "ilan@multi.test", name: "Ilan" } });
  const yuval = await db.user.create({ data: { email: "yuval@multi.test", name: "Yuval" } });
  const outsider = await db.user.create({ data: { email: "out@multi.test", name: "Out" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: ilan.id, role: "owner" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: yuval.id, role: "member" } });
  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Multi",
      slug: "multi",
      columns: { create: [{ name: "To Do", position: 0 }, { name: "Done", position: 1, isDone: true }] },
    },
  });
  const cols = await db.column.findMany({ where: { boardId: board.id }, orderBy: { position: "asc" } });
  await db.boardAccess.create({ data: { boardId: board.id, userId: yuval.id, level: "edit" } });
  const agent = await db.agent.create({ data: { workspaceId: ws.id, name: "Hermes" } });
  seed = {
    boardId: board.id,
    todoId: cols[0].id,
    doneId: cols[1].id,
    ilan: { type: "user", id: ilan.id, name: "Ilan" },
    yuval: { type: "user", id: yuval.id, name: "Yuval" },
    outsiderId: outsider.id,
    agentId: agent.id,
  };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("create with assigneeUserIds sets all assignees; first is primary", async () => {
  const t = await createTicket(
    { boardId: seed.boardId, title: "Pair work", assigneeUserIds: [seed.ilan.id!, seed.yuval.id!] },
    seed.ilan,
  );
  assert.equal(t.assignee?.type, "user");
  assert.equal(t.assignee?.id, seed.ilan.id);
  assert.deepEqual(t.assignees.map((a) => a.id), [seed.ilan.id, seed.yuval.id]);
  const row = await db.ticket.findUnique({ where: { id: t.id } });
  assert.equal(row?.assigneeType, "user");
  assert.equal(row?.assigneeUserId, seed.ilan.id); // legacy mirror
});

test("legacy single assigneeUserId still works and yields one assignee row", async () => {
  const t = await createTicket(
    { boardId: seed.boardId, title: "Solo", assigneeType: "user", assigneeUserId: seed.yuval.id },
    seed.ilan,
  );
  assert.deepEqual(t.assignees.map((a) => a.id), [seed.yuval.id]);
  assert.equal(t.assignee?.id, seed.yuval.id);
});

test("non-member in assigneeUserIds is rejected", async () => {
  await assert.rejects(
    createTicket(
      { boardId: seed.boardId, title: "Bad", assigneeUserIds: [seed.ilan.id!, seed.outsiderId] },
      seed.ilan,
    ),
    (err: unknown) => err instanceof HttpError && err.status === 422,
  );
});

test("update replaces the list; agent assignment clears human rows", async () => {
  const t = await createTicket(
    { boardId: seed.boardId, title: "Handoff", assigneeUserIds: [seed.ilan.id!, seed.yuval.id!] },
    seed.ilan,
  );
  const solo = await updateTicket(t.id, { assigneeUserIds: [seed.yuval.id!] }, seed.ilan);
  assert.equal(solo.assignee?.id, seed.yuval.id);
  assert.deepEqual(solo.assignees.map((a) => a.id), [seed.yuval.id]);

  const toAgent = await updateTicket(t.id, { assigneeType: "agent", assigneeAgentId: seed.agentId }, seed.ilan);
  assert.equal(toAgent.assignee?.type, "agent");
  assert.equal(await db.ticketAssignee.count({ where: { ticketId: t.id } }), 0);

  const cleared = await updateTicket(t.id, { assigneeType: null }, seed.ilan);
  assert.equal(cleared.assignee, null);
  assert.deepEqual(cleared.assignees, []);
});

test("completedAt is stamped entering a done column and cleared on the way out", async () => {
  const t = await createTicket(
    { boardId: seed.boardId, title: "Finish me", dueDate: "2020-01-01" },
    seed.ilan,
  );
  assert.equal(t.completedAt, null);
  assert.equal(t.isDone, false);

  const done = await moveTicket(t.id, seed.doneId, 0, seed.ilan);
  assert.ok(done.completedAt);
  assert.equal(done.isDone, true);

  // Reordering within done keeps the original completion time.
  const still = await moveTicket(t.id, seed.doneId, 0, seed.ilan);
  assert.equal(still.completedAt, done.completedAt);

  const reopened = await moveTicket(t.id, seed.todoId, 0, seed.ilan);
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.isDone, false);
});
