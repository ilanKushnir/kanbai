import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { hashApiKey } from "@/lib/crypto";
import {
  createSystemInvite,
  createWorkspaceInvite,
  applyWorkspaceInvite,
  redeemSystemInviteSignup,
  findValidInvite,
} from "./invites";
import { setBoardMemberAccess } from "./board-members";
import { POST as V1_MEMBERS_POST } from "@/app/api/v1/members/route";

// Invitation semantics, strictly split:
//   - system ("account") invites: system admin only; the ONLY way a new person
//     can register an account (they get their own personal workspace);
//   - workspace invites: owner/admin invites an EXISTING account in; unknown
//     emails are rejected and no account is ever created;
//   - board sharing only ever targets users already in the workspace.

const ACTOR = { type: "user" as const, id: null, name: "Test" };
const AGENT_KEY = "kbai_live_inv_agent_key_0000000000000";

let wsId: string;
let boardId: string;
let root: { id: string; systemRole: string }; // system admin, workspace owner
let wsAdmin: string; // workspace admin (NOT system admin)
let member: string; // plain workspace member
let outsiderEmail = "freja@inv.test"; // existing account, not in the workspace
let outsider: string;

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
  await db.invite.deleteMany();
  await db.session.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const rootUser = await db.user.create({
    data: { email: "root@inv.test", name: "Root", systemRole: "admin" },
  });
  root = { id: rootUser.id, systemRole: rootUser.systemRole };

  const ws = await db.workspace.create({ data: { name: "Inv WS", slug: "inv-ws", ownerId: root.id } });
  wsId = ws.id;
  boardId = (await db.board.create({ data: { workspaceId: wsId, name: "Inv board", slug: "inv-board" } })).id;

  const mk = (email: string, name: string) => db.user.create({ data: { email, name, systemRole: "user" } });
  wsAdmin = (await mk("admin@inv.test", "Wanda")).id;
  member = (await mk("mel@inv.test", "Mel")).id;
  outsider = (await mk(outsiderEmail, "Freja")).id;

  await db.workspaceMember.createMany({
    data: [
      { workspaceId: wsId, userId: root.id, role: "owner" },
      { workspaceId: wsId, userId: wsAdmin, role: "admin" },
      { workspaceId: wsId, userId: member, role: "member" },
    ],
  });

  await db.agent.create({
    data: { workspaceId: wsId, name: "Inv bot", apiKeyHash: hashApiKey(AGENT_KEY), scopes: "members:write" },
  });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

// ── System (account) invites ──

test("non-system-admin cannot create a system invite", async () => {
  for (const id of [wsAdmin, member]) {
    await assert.rejects(
      () => createSystemInvite({ invitedBy: { id, systemRole: "user" }, email: "new@inv.test" }),
      (e: unknown) => e instanceof HttpError && e.status === 403,
    );
  }
  assert.equal(await db.invite.count({ where: { kind: "account" } }), 0);
});

test("system invite (by the system admin) can register a new account", async () => {
  const { token, invite } = await createSystemInvite({ invitedBy: root, email: "nina@inv.test" });
  assert.equal(invite.kind, "account");
  assert.equal(invite.workspaceId, null); // system-level: never tied to a workspace

  const valid = await findValidInvite(token);
  assert.ok(valid);
  const user = await redeemSystemInviteSignup(valid, {
    email: "nina@inv.test",
    name: "Nina",
    passwordHash: hashPassword("hunter2hunter2"),
  });

  assert.equal(user.systemRole, "user");
  // She got her own personal workspace…
  const membership = await db.workspaceMember.findFirst({ where: { userId: user.id } });
  assert.equal(membership?.role, "owner");
  assert.notEqual(membership?.workspaceId, wsId);
  // …and the invite is spent.
  const spent = await db.invite.findUnique({ where: { id: invite.id } });
  assert.equal(spent?.status, "accepted");
  assert.equal(spent?.acceptedById, user.id);
  assert.equal(await findValidInvite(token), null);
});

test("system invite rejects an email that already has an account", async () => {
  await assert.rejects(
    () => createSystemInvite({ invitedBy: root, email: outsiderEmail }),
    (e: unknown) => e instanceof HttpError && e.status === 409,
  );
});

// ── Workspace invites ──

test("workspace admin can invite an existing user (who then joins with presets)", async () => {
  const { invite } = await createWorkspaceInvite({
    workspaceId: wsId,
    invitedById: wsAdmin,
    actorRole: "admin",
    email: outsiderEmail,
    role: "member",
    boardAccess: [{ boardId, level: "view" }],
  });
  assert.equal(invite.kind, "workspace");
  assert.equal(invite.workspaceId, wsId);
  assert.equal(invite.email, outsiderEmail);

  const joined = await applyWorkspaceInvite(invite, outsider);
  assert.equal(joined, wsId);
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: wsId, userId: outsider } },
  });
  assert.equal(membership?.role, "member");
  const grant = await db.boardAccess.findUnique({
    where: { boardId_userId: { boardId, userId: outsider } },
  });
  assert.equal(grant?.level, "view");

  // Clean up the membership/grant so later tests see Freja as an outsider again.
  await db.boardAccess.deleteMany({ where: { userId: outsider } });
  await db.workspaceMember.deleteMany({ where: { userId: outsider } });
});

test("workspace invite creation rejects unknown emails (no account is created)", async () => {
  const usersBefore = await db.user.count();
  await assert.rejects(
    () =>
      createWorkspaceInvite({
        workspaceId: wsId,
        invitedById: wsAdmin,
        actorRole: "admin",
        email: "stranger@inv.test",
      }),
    (e: unknown) => e instanceof HttpError && e.status === 422 && e.code === "unknown_email",
  );
  assert.equal(await db.user.count(), usersBefore);
});

test("a workspace invite can never register a new account at signup", async () => {
  const { invite } = await createWorkspaceInvite({
    workspaceId: wsId,
    invitedById: root.id,
    actorRole: "owner",
    email: outsiderEmail,
  });
  const usersBefore = await db.user.count();
  await assert.rejects(
    () =>
      redeemSystemInviteSignup(invite, {
        email: "impostor@inv.test",
        name: "Impostor",
        passwordHash: hashPassword("hunter2hunter2"),
      }),
    (e: unknown) => e instanceof HttpError && e.status === 403,
  );
  assert.equal(await db.user.count(), usersBefore);
});

test("workspace member cannot create workspace invites", async () => {
  await assert.rejects(
    () =>
      createWorkspaceInvite({
        workspaceId: wsId,
        invitedById: member,
        actorRole: "member",
        email: outsiderEmail,
      }),
    (e: unknown) => e instanceof HttpError && e.status === 403,
  );
});

test("inviting someone who is already a member is rejected", async () => {
  await assert.rejects(
    () =>
      createWorkspaceInvite({
        workspaceId: wsId,
        invitedById: wsAdmin,
        actorRole: "admin",
        email: "mel@inv.test",
      }),
    (e: unknown) => e instanceof HttpError && e.status === 409 && e.code === "already_member",
  );
});

// ── Board sharing stays inside the workspace ──

test("board sharing can target workspace users only", async () => {
  // A workspace member can be granted board access…
  await setBoardMemberAccess(boardId, member, "edit", ACTOR);
  const grant = await db.boardAccess.findUnique({
    where: { boardId_userId: { boardId, userId: member } },
  });
  assert.equal(grant?.level, "edit");

  // …but a user outside the workspace cannot.
  await assert.rejects(
    () => setBoardMemberAccess(boardId, outsider, "view", ACTOR),
    (e: unknown) => e instanceof HttpError && e.status === 422,
  );
});

// ── Agent API can no longer mint accounts ──

test("v1 members POST rejects unknown emails and only attaches existing users", async () => {
  const post = (email: string) =>
    V1_MEMBERS_POST(
      new Request("http://test.local/api/v1/members", {
        method: "POST",
        headers: { authorization: `Bearer ${AGENT_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ email, role: "member" }),
      }),
    );

  const usersBefore = await db.user.count();
  const rejected = await post("ghost@inv.test");
  assert.equal(rejected.status, 422);
  assert.equal(await db.user.count(), usersBefore); // strictly no account creation

  const added = await post(outsiderEmail);
  assert.equal(added.status, 201);
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: wsId, userId: outsider } },
  });
  assert.equal(membership?.role, "member");
});
