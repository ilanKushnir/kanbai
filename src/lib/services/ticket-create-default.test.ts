import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { myDayTicketScope } from "@/lib/my-day";
import { createTicket, type Actor } from "./tickets";
import { fulfillNote } from "./notes";

// Creation-default semantics: a human creating a ticket takes it by default —
// no assignee input at all lands the ticket on the creator's own plate. An
// explicit assignee (user/agent) or an explicit null ("Unassigned") is always
// honored, and agent/system actors never inherit a human assignee. My Day is
// scoped by the same rule: only tickets assigned to the current user appear.
// Runs against the throwaway SQLite db set up by the `test` script.

type Seed = {
  workspaceId: string;
  boardId: string;
  ilan: Actor; // workspace owner
  yuval: Actor; // member, board shared with them (edit)
  botId: string; // ownerless workspace agent
};
let seed: Seed;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.subtask.deleteMany();
  await db.ticket.deleteMany();
  await db.note.deleteMany();
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

  const ws = await db.workspace.create({ data: { name: "Default WS", slug: "default-ws" } });
  const ilan = await db.user.create({ data: { email: "ilan@default.test", name: "Ilan" } });
  const yuval = await db.user.create({ data: { email: "yuval@default.test", name: "Yuval" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: ilan.id, role: "owner" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: yuval.id, role: "member" } });

  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Defaults",
      slug: "defaults",
      columns: { create: [{ name: "To Do", position: 0 }] },
    },
  });
  await db.boardAccess.create({ data: { boardId: board.id, userId: yuval.id, level: "edit" } });

  const bot = await db.agent.create({ data: { workspaceId: ws.id, name: "Hermes" } });

  seed = {
    workspaceId: ws.id,
    boardId: board.id,
    ilan: { type: "user", id: ilan.id, name: "Ilan" },
    yuval: { type: "user", id: yuval.id, name: "Yuval" },
    botId: bot.id,
  };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("a user-created ticket defaults its assignee to the creator", async () => {
  const ticket = await createTicket({ boardId: seed.boardId, title: "Mine by default" }, seed.ilan);
  assert.deepEqual(
    { type: ticket.assignee?.type, id: ticket.assignee?.id },
    { type: "user", id: seed.ilan.id },
  );

  // Non-manager members with a board grant get the same default.
  const member = await createTicket({ boardId: seed.boardId, title: "Member default" }, seed.yuval);
  assert.equal(member.assignee?.id, seed.yuval.id);
});

test("an explicit assignee overrides the creator default", async () => {
  const toOther = await createTicket(
    { boardId: seed.boardId, title: "For Yuval", assigneeType: "user", assigneeUserId: seed.yuval.id },
    seed.ilan,
  );
  assert.equal(toOther.assignee?.id, seed.yuval.id);

  const toAgent = await createTicket(
    { boardId: seed.boardId, title: "For Hermes", assigneeType: "agent", assigneeAgentId: seed.botId },
    seed.ilan,
  );
  assert.deepEqual({ type: toAgent.assignee?.type, id: toAgent.assignee?.id }, { type: "agent", id: seed.botId });
});

test("an explicit null assignee stays unassigned", async () => {
  const cleared = await createTicket(
    { boardId: seed.boardId, title: "Deliberately unassigned", assigneeType: null },
    seed.ilan,
  );
  assert.equal(cleared.assignee, null);
});

test("agent- and system-created tickets never inherit a human assignee", async () => {
  const agentActor: Actor = { type: "agent", id: seed.botId, name: "Hermes" };
  const byAgent = await createTicket({ boardId: seed.boardId, title: "Agent filed" }, agentActor);
  assert.equal(byAgent.assignee, null);

  const byAgentExplicit = await createTicket(
    { boardId: seed.boardId, title: "Agent assigns a human", assigneeType: "user", assigneeUserId: seed.yuval.id },
    agentActor,
  );
  assert.equal(byAgentExplicit.assignee?.id, seed.yuval.id);

  const bySystem = await createTicket({ boardId: seed.boardId, title: "System filed" }, { type: "system", name: "sys" });
  assert.equal(bySystem.assignee, null);
});

test("a note promoted by its user lands on that user's plate; agent promotions stay unassigned", async () => {
  const userNote = await db.note.create({ data: { userId: seed.ilan.id!, body: "capture me" } });
  const promoted = await fulfillNote(userNote.id, { boardId: seed.boardId, title: "From my note" }, seed.ilan);
  assert.deepEqual(
    { type: promoted.assignee?.type, id: promoted.assignee?.id },
    { type: "user", id: seed.ilan.id },
  );

  const agentNote = await db.note.create({ data: { userId: seed.ilan.id!, body: "agent sorts me" } });
  const sorted = await fulfillNote(
    agentNote.id,
    { boardId: seed.boardId, title: "Agent sorted" },
    { type: "agent", id: seed.botId, name: "Hermes" },
  );
  assert.equal(sorted.assignee, null);
});

test("My Day scope keeps only the current user's assigned tickets", async () => {
  await wipeTickets();
  const mine = await createTicket({ boardId: seed.boardId, title: "Assigned to me" }, seed.ilan);
  await createTicket({ boardId: seed.boardId, title: "Unassigned", assigneeType: null }, seed.ilan);
  await createTicket(
    { boardId: seed.boardId, title: "Someone else's", assigneeType: "user", assigneeUserId: seed.yuval.id },
    seed.ilan,
  );
  await createTicket(
    { boardId: seed.boardId, title: "An agent's", assigneeType: "agent", assigneeAgentId: seed.botId },
    seed.ilan,
  );

  // The exact shape the My Day page queries with (manager board scope).
  const rows = await db.ticket.findMany({
    where: {
      board: { workspaceId: seed.workspaceId, archived: false },
      column: { isDone: false },
      deletedAt: null,
      ...myDayTicketScope(seed.ilan.id!),
    },
    select: { id: true, title: true },
  });
  assert.deepEqual(rows.map((t) => t.id), [mine.id]);
});

async function wipeTickets() {
  await db.ticket.deleteMany();
}
