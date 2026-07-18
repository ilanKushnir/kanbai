import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { createTicket, updateTicket, type Actor } from "./tickets";

// Agent-assignee ownership: an agent with an owner belongs to that user —
// only the owner (or an agent acting for the same owner) may assign tickets
// to it. Ownerless workspace agents stay assignable by anyone, and assigned
// agents serialize with owner context ("Hermes · Yuval") for display.
// Runs against the throwaway SQLite db set up by the `test` script.

type Seed = {
  boardId: string;
  ilan: Actor; // workspace owner
  yuval: Actor; // member, board shared with them
  ilanBotId: string;
  yuvalBotId: string;
  wsBotId: string; // ownerless workspace agent
};
let seed: Seed;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
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

  const ws = await db.workspace.create({ data: { name: "Own WS", slug: "own-ws" } });
  const ilan = await db.user.create({ data: { email: "ilan@own.test", name: "Ilan" } });
  const yuval = await db.user.create({ data: { email: "yuval@own.test", name: "Yuval" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: ilan.id, role: "owner" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: yuval.id, role: "member" } });

  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Owned",
      slug: "owned",
      columns: { create: [{ name: "To Do", position: 0 }] },
    },
  });
  await db.boardAccess.create({ data: { boardId: board.id, userId: yuval.id, level: "edit" } });

  const ilanBot = await db.agent.create({ data: { workspaceId: ws.id, name: "IlanBot", ownerUserId: ilan.id } });
  const yuvalBot = await db.agent.create({ data: { workspaceId: ws.id, name: "YuvalBot", ownerUserId: yuval.id } });
  const wsBot = await db.agent.create({ data: { workspaceId: ws.id, name: "Hermes" } });

  seed = {
    boardId: board.id,
    ilan: { type: "user", id: ilan.id, name: "Ilan" },
    yuval: { type: "user", id: yuval.id, name: "Yuval" },
    ilanBotId: ilanBot.id,
    yuvalBotId: yuvalBot.id,
    wsBotId: wsBot.id,
  };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

function assertNotOwned(err: unknown): boolean {
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 422);
  assert.equal(err.code, "assignee_agent_not_owned");
  return true;
}

test("a user can assign tickets to their own agent", async () => {
  const ticket = await createTicket(
    { boardId: seed.boardId, title: "Mine", assigneeType: "agent", assigneeAgentId: seed.ilanBotId },
    seed.ilan,
  );
  assert.deepEqual({ type: ticket.assignee?.type, id: ticket.assignee?.id }, { type: "agent", id: seed.ilanBotId });
});

test("a user cannot assign tickets to someone else's agent", async () => {
  await assert.rejects(
    createTicket(
      { boardId: seed.boardId, title: "Not mine", assigneeType: "agent", assigneeAgentId: seed.yuvalBotId },
      seed.ilan,
    ),
    assertNotOwned,
  );
});

test("ownerless workspace agents are assignable by anyone", async () => {
  const ticket = await createTicket(
    { boardId: seed.boardId, title: "For Hermes", assigneeType: "agent", assigneeAgentId: seed.wsBotId },
    seed.yuval,
  );
  assert.equal(ticket.assignee?.id, seed.wsBotId);
});

test("update follows the same ownership rule", async () => {
  const ticket = await createTicket({ boardId: seed.boardId, title: "Reassign me" }, seed.yuval);
  const updated = await updateTicket(
    ticket.id,
    { assigneeType: "agent", assigneeAgentId: seed.yuvalBotId },
    seed.yuval,
  );
  assert.equal(updated.assignee?.id, seed.yuvalBotId);

  await assert.rejects(
    updateTicket(ticket.id, { assigneeType: "agent", assigneeAgentId: seed.ilanBotId }, seed.yuval),
    assertNotOwned,
  );
});

test("agent actors are capped to their owner's fleet; workspace agents are not", async () => {
  const yuvalBot: Actor = { type: "agent", id: seed.yuvalBotId, name: "YuvalBot" };
  // Self-assignment is always fine.
  const self = await createTicket(
    { boardId: seed.boardId, title: "I'll take it", assigneeType: "agent", assigneeAgentId: seed.yuvalBotId },
    yuvalBot,
  );
  assert.equal(self.assignee?.id, seed.yuvalBotId);

  // Another owner's agent is off-limits, exactly as for its owner.
  await assert.rejects(
    createTicket(
      { boardId: seed.boardId, title: "Poaching", assigneeType: "agent", assigneeAgentId: seed.ilanBotId },
      yuvalBot,
    ),
    assertNotOwned,
  );

  // Workspace-level automation (ownerless actor) may dispatch to any agent.
  const hermes: Actor = { type: "agent", id: seed.wsBotId, name: "Hermes" };
  const dispatched = await createTicket(
    { boardId: seed.boardId, title: "Dispatched", assigneeType: "agent", assigneeAgentId: seed.ilanBotId },
    hermes,
  );
  assert.equal(dispatched.assignee?.id, seed.ilanBotId);
});

test("agent assignees serialize with owner context; workspace agents without", async () => {
  const owned = await createTicket(
    { boardId: seed.boardId, title: "Owned display", assigneeType: "agent", assigneeAgentId: seed.yuvalBotId },
    seed.yuval,
  );
  assert.deepEqual(
    {
      name: owned.assignee?.name,
      ownerUserId: owned.assignee?.ownerUserId,
      ownerName: owned.assignee?.ownerName,
    },
    { name: "YuvalBot", ownerUserId: seed.yuval.id, ownerName: "Yuval" },
  );

  const workspace = await createTicket(
    { boardId: seed.boardId, title: "Workspace display", assigneeType: "agent", assigneeAgentId: seed.wsBotId },
    seed.ilan,
  );
  assert.equal(workspace.assignee?.ownerUserId, null);
  assert.equal(workspace.assignee?.ownerName, null);

  // Human assignees carry no agent-owner context.
  const human = await createTicket(
    { boardId: seed.boardId, title: "Human display", assigneeType: "user", assigneeUserId: seed.yuval.id ?? "" },
    seed.ilan,
  );
  assert.equal(human.assignee?.type, "user");
  assert.equal(human.assignee?.ownerName, undefined);
});
