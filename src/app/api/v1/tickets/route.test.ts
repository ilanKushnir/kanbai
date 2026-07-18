import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { POST } from "./route";
import { PATCH } from "./[ticketId]/route";

// Agent ticket create/assign authorization: a human assignee must be an
// *assignable board member* — a workspace manager (implicit access) or a
// member the board is shared with (BoardAccess grant, any level). Outsiders,
// unknown ids, and unshared members are rejected with 422.
// Runs against the throwaway SQLite db set up by the `test` script.

const AGENT_KEY = "kbai_live_asg_agent_key_0000000000000";
const ALICE_BOT_KEY = "kbai_live_asg_alice_bot_key_000000000";

type Seed = {
  boardId: string;
  columnId: string;
  ticketId: string;
  ownerId: string; // workspace owner → implicitly assignable everywhere
  aliceId: string; // member, edit grant on the board → assignable
  carolId: string; // member, view grant on the board → still assignable
  bobId: string; // member, board NOT shared → not assignable
  daveId: string; // user from another workspace → never assignable
  aliceBotId: string; // agent owned by Alice
  carolBotId: string; // agent owned by Carol
};
let seed: Seed;

function req(body: unknown, method = "POST", key = AGENT_KEY) {
  return new Request("http://test.local/api/v1/tickets", {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

function ctx(ticketId: string) {
  return { params: Promise.resolve({ ticketId }) };
}

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

  const ws = await db.workspace.create({ data: { name: "Asg WS", slug: "asg-ws" } });
  const otherWs = await db.workspace.create({ data: { name: "Asg Other WS", slug: "asg-other-ws" } });

  const owner = await db.user.create({ data: { email: "owner@asg.test", name: "Owner" } });
  const alice = await db.user.create({ data: { email: "alice@asg.test", name: "Alice" } });
  const carol = await db.user.create({ data: { email: "carol@asg.test", name: "Carol" } });
  const bob = await db.user.create({ data: { email: "bob@asg.test", name: "Bob" } });
  const dave = await db.user.create({ data: { email: "dave@asg.test", name: "Dave" } });

  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: owner.id, role: "owner" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: alice.id, role: "member" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: carol.id, role: "member" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: bob.id, role: "member" } });
  await db.workspaceMember.create({ data: { workspaceId: otherWs.id, userId: dave.id, role: "owner" } });

  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Shared",
      slug: "shared",
      columns: { create: [{ name: "To Do", position: 0 }] },
    },
    include: { columns: true },
  });
  // The board is shared with Alice (edit) and Carol (view) — but not Bob.
  await db.boardAccess.create({ data: { boardId: board.id, userId: alice.id, level: "edit" } });
  await db.boardAccess.create({ data: { boardId: board.id, userId: carol.id, level: "view" } });

  const ticket = await db.ticket.create({
    data: { boardId: board.id, columnId: board.columns[0].id, title: "Existing", number: 1 },
  });

  await db.agent.create({
    data: { workspaceId: ws.id, name: "Filer", apiKeyHash: hashApiKey(AGENT_KEY), scopes: "tickets:read,tickets:write" },
  });
  const aliceBot = await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "AliceBot",
      ownerUserId: alice.id,
      apiKeyHash: hashApiKey(ALICE_BOT_KEY),
      scopes: "tickets:read,tickets:write",
    },
  });
  const carolBot = await db.agent.create({
    data: { workspaceId: ws.id, name: "CarolBot", ownerUserId: carol.id },
  });

  seed = {
    boardId: board.id,
    columnId: board.columns[0].id,
    ticketId: ticket.id,
    ownerId: owner.id,
    aliceId: alice.id,
    carolId: carol.id,
    bobId: bob.id,
    daveId: dave.id,
    aliceBotId: aliceBot.id,
    carolBotId: carolBot.id,
  };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("create with assigneeUserId of a shared member → 201, assigned", async () => {
  const res = await POST(req({ boardId: seed.boardId, title: "For Alice", assigneeUserId: seed.aliceId }));
  assert.equal(res.status, 201);
  const { ticket } = await res.json();
  assert.deepEqual({ type: ticket.assignee.type, id: ticket.assignee.id }, { type: "user", id: seed.aliceId });
});

test("managers are assignable without an explicit grant; view-level grants count too", async () => {
  const toOwner = await POST(req({ boardId: seed.boardId, title: "For Owner", assigneeUserId: seed.ownerId }));
  assert.equal(toOwner.status, 201);
  const toCarol = await POST(req({ boardId: seed.boardId, title: "For Carol", assigneeUserId: seed.carolId }));
  assert.equal(toCarol.status, 201);
});

test("create assigning a member the board is NOT shared with → 422", async () => {
  const res = await POST(req({ boardId: seed.boardId, title: "For Bob", assigneeUserId: seed.bobId }));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "assignee_no_board_access");
});

test("create assigning an outsider or unknown user id → 422", async () => {
  const foreign = await POST(req({ boardId: seed.boardId, title: "For Dave", assigneeUserId: seed.daveId }));
  assert.equal(foreign.status, 422);
  assert.equal((await foreign.json()).error.code, "assignee_not_member");
  const unknown = await POST(req({ boardId: seed.boardId, title: "For nobody", assigneeUserId: "usr_missing" }));
  assert.equal(unknown.status, 422);
});

test("create by assigneeEmail resolves shared members and rejects unknowns", async () => {
  const ok = await POST(req({ boardId: seed.boardId, title: "By email", assigneeEmail: "alice@asg.test" }));
  assert.equal(ok.status, 201);
  const { ticket } = await ok.json();
  assert.equal(ticket.assignee.id, seed.aliceId);

  const unknown = await POST(req({ boardId: seed.boardId, title: "By email", assigneeEmail: "nobody@asg.test" }));
  assert.equal(unknown.status, 422);
  assert.equal((await unknown.json()).error.code, "assignee_not_member");

  const unshared = await POST(req({ boardId: seed.boardId, title: "By email", assigneeEmail: "bob@asg.test" }));
  assert.equal(unshared.status, 422);
  assert.equal((await unshared.json()).error.code, "assignee_no_board_access");
});

test("owner-mapped agent may self-assign but not assign another owner's agent", async () => {
  const self = await POST(
    req({ boardId: seed.boardId, title: "AliceBot takes it", assigneeAgentId: seed.aliceBotId }, "POST", ALICE_BOT_KEY),
  );
  assert.equal(self.status, 201);

  const poached = await POST(
    req({ boardId: seed.boardId, title: "Poaching", assigneeAgentId: seed.carolBotId }, "POST", ALICE_BOT_KEY),
  );
  assert.equal(poached.status, 422);
  assert.equal((await poached.json()).error.code, "assignee_agent_not_owned");
});

test("workspace (ownerless) agent may dispatch to any agent, with owner context serialized", async () => {
  const res = await POST(req({ boardId: seed.boardId, title: "Dispatch", assigneeAgentId: seed.carolBotId }));
  assert.equal(res.status, 201);
  const { ticket } = await res.json();
  assert.deepEqual(
    { name: ticket.assignee.name, ownerUserId: ticket.assignee.ownerUserId, ownerName: ticket.assignee.ownerName },
    { name: "CarolBot", ownerUserId: seed.carolId, ownerName: "Carol" },
  );
});

test("PATCH reassignment follows the same rule", async () => {
  const denied = await PATCH(
    req({ assigneeType: "user", assigneeUserId: seed.bobId }, "PATCH"),
    ctx(seed.ticketId),
  );
  assert.equal(denied.status, 422);
  assert.equal((await denied.json()).error.code, "assignee_no_board_access");

  const allowed = await PATCH(
    req({ assigneeType: "user", assigneeUserId: seed.aliceId }, "PATCH"),
    ctx(seed.ticketId),
  );
  assert.equal(allowed.status, 200);
  const { ticket } = await allowed.json();
  assert.deepEqual({ type: ticket.assignee.type, id: ticket.assignee.id }, { type: "user", id: seed.aliceId });

  // Unassigning stays possible.
  const cleared = await PATCH(req({ assigneeType: null }, "PATCH"), ctx(seed.ticketId));
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).ticket.assignee, null);
});
