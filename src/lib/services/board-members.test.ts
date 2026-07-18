import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { listBoardMembers, boardAssigneeUsers, setBoardMemberAccess } from "./board-members";
import { updateAgent } from "./agents";
import { agentAccessibleBoardIds, assertAgentBoardAccess } from "@/lib/access";

// Board sharing semantics: owners/admins implicitly access every board; plain
// members need a BoardAccess grant. Also covers the agent→owner access cap.

const ACTOR = { type: "user" as const, id: null, name: "Test" };

let wsId: string;
let boardAId: string;
let boardBId: string;
let alice: string; // workspace owner
let adam: string; // admin
let bob: string; // member, edit on board A
let carol: string; // member, no grants
let mallory: string; // not in the workspace

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
  const ws = await db.workspace.create({ data: { name: "BM WS", slug: "bm-ws" } });
  wsId = ws.id;

  const mk = (email: string, name: string) => db.user.create({ data: { email, name } });
  alice = (await mk("alice@bm.test", "Alice")).id;
  adam = (await mk("adam@bm.test", "Adam")).id;
  bob = (await mk("bob@bm.test", "Bob")).id;
  carol = (await mk("carol@bm.test", "Carol")).id;
  mallory = (await mk("mallory@bm.test", "Mallory")).id;

  await db.workspaceMember.createMany({
    data: [
      { workspaceId: wsId, userId: alice, role: "owner" },
      { workspaceId: wsId, userId: adam, role: "admin" },
      { workspaceId: wsId, userId: bob, role: "member" },
      { workspaceId: wsId, userId: carol, role: "member" },
    ],
  });

  boardAId = (await db.board.create({ data: { workspaceId: wsId, name: "A", slug: "a" } })).id;
  boardBId = (await db.board.create({ data: { workspaceId: wsId, name: "B", slug: "b" } })).id;
  await db.boardAccess.create({ data: { boardId: boardAId, userId: bob, level: "edit" } });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("listBoardMembers: managers implicit, members show their grant (or none)", async () => {
  const members = await listBoardMembers(boardAId);
  const by = new Map(members.map((m) => [m.userId, m]));
  assert.equal(by.get(alice)?.implicit, true);
  assert.equal(by.get(alice)?.role, "owner");
  assert.equal(by.get(adam)?.implicit, true);
  assert.equal(by.get(bob)?.implicit, false);
  assert.equal(by.get(bob)?.level, "edit");
  assert.equal(by.get(carol)?.level, null);
  assert.equal(by.has(mallory), false); // not a workspace member at all
});

test("boardAssigneeUsers: managers + granted members only", async () => {
  const users = (await boardAssigneeUsers(boardAId)).map((u) => u.id).sort();
  assert.deepEqual(users, [alice, adam, bob].sort());
  // Board B has no grants — only the managers are assignable.
  const usersB = (await boardAssigneeUsers(boardBId)).map((u) => u.id).sort();
  assert.deepEqual(usersB, [alice, adam].sort());
});

test("setBoardMemberAccess grants, changes, and revokes", async () => {
  await setBoardMemberAccess(boardAId, carol, "view", ACTOR);
  let by = new Map((await listBoardMembers(boardAId)).map((m) => [m.userId, m]));
  assert.equal(by.get(carol)?.level, "view");

  await setBoardMemberAccess(boardAId, carol, "edit", ACTOR);
  by = new Map((await listBoardMembers(boardAId)).map((m) => [m.userId, m]));
  assert.equal(by.get(carol)?.level, "edit");

  await setBoardMemberAccess(boardAId, carol, null, ACTOR);
  by = new Map((await listBoardMembers(boardAId)).map((m) => [m.userId, m]));
  assert.equal(by.get(carol)?.level, null);
  assert.equal(await db.boardAccess.count({ where: { boardId: boardAId, userId: carol } }), 0);
});

test("managers can't be edited per-board; outsiders are rejected", async () => {
  await assert.rejects(
    () => setBoardMemberAccess(boardAId, adam, "view", ACTOR),
    (e: unknown) => e instanceof HttpError && e.status === 422 && e.code === "implicit_access",
  );
  await assert.rejects(
    () => setBoardMemberAccess(boardAId, mallory, "edit", ACTOR),
    (e: unknown) => e instanceof HttpError && e.status === 422,
  );
  await assert.rejects(
    () => setBoardMemberAccess("brd_missing", carol, "edit", ACTOR),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
});

test("agentAccessibleBoardIds mirrors the owning user's access", async () => {
  const base = { workspaceId: wsId };
  // No owner → workspace-wide (null).
  assert.equal(await agentAccessibleBoardIds({ ...base, ownerUserId: null }), null);
  // Manager owner → workspace-wide.
  assert.equal(await agentAccessibleBoardIds({ ...base, ownerUserId: adam }), null);
  // Member owner → exactly their grants.
  assert.deepEqual(await agentAccessibleBoardIds({ ...base, ownerUserId: bob }), [boardAId]);
  // Owner who isn't a member of the workspace → nothing.
  assert.deepEqual(await agentAccessibleBoardIds({ ...base, ownerUserId: mallory }), []);
});

test("updateAgent: the owner must belong to the agent's workspace; null clears it", async () => {
  const agent = await db.agent.create({ data: { workspaceId: wsId, name: "Owned bot" } });
  await updateAgent(agent.id, { ownerUserId: bob });
  assert.equal((await db.agent.findUnique({ where: { id: agent.id } }))?.ownerUserId, bob);
  await assert.rejects(
    () => updateAgent(agent.id, { ownerUserId: mallory }),
    (e: unknown) => e instanceof HttpError && e.status === 422,
  );
  await updateAgent(agent.id, { ownerUserId: null });
  assert.equal((await db.agent.findUnique({ where: { id: agent.id } }))?.ownerUserId, null);
});

test("assertAgentBoardAccess: 404 outside the owner's boards", async () => {
  const limited = { workspaceId: wsId, ownerUserId: bob };
  await assert.doesNotReject(() => assertAgentBoardAccess(limited, boardAId));
  await assert.rejects(
    () => assertAgentBoardAccess(limited, boardBId),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
});
