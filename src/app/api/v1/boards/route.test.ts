import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { GET } from "./route";
import { GET as GET_BOARD } from "./[boardId]/route";

// Authorization boundary: an owner-mapped agent only sees/reads the boards its
// owning user can access; a legacy (ownerless) agent still sees the workspace.

const FULL_KEY = "kbai_live_bl_full_key_000000000000000";
const LIMITED_KEY = "kbai_live_bl_limited_key_000000000000";

let boardAId: string;
let boardBId: string;

function req(key: string) {
  return new Request("http://test.local/api/v1/boards", {
    headers: { authorization: `Bearer ${key}` },
  });
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
  const ws = await db.workspace.create({ data: { name: "BL WS", slug: "bl-ws" } });
  const bob = await db.user.create({ data: { email: "bob@bl.test", name: "Bob" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: bob.id, role: "member" } });

  boardAId = (await db.board.create({ data: { workspaceId: ws.id, name: "Visible", slug: "visible" } })).id;
  boardBId = (await db.board.create({ data: { workspaceId: ws.id, name: "Hidden", slug: "hidden" } })).id;
  await db.boardAccess.create({ data: { boardId: boardAId, userId: bob.id, level: "edit" } });

  await db.agent.create({
    data: { workspaceId: ws.id, name: "Full", apiKeyHash: hashApiKey(FULL_KEY), scopes: "boards:read" },
  });
  await db.agent.create({
    data: { workspaceId: ws.id, name: "Limited", apiKeyHash: hashApiKey(LIMITED_KEY), scopes: "boards:read", ownerUserId: bob.id },
  });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("legacy agent (no owner) lists every workspace board", async () => {
  const res = await GET(req(FULL_KEY));
  assert.equal(res.status, 200);
  const { boards } = await res.json();
  assert.deepEqual(boards.map((b: { id: string }) => b.id).sort(), [boardAId, boardBId].sort());
});

test("owner-mapped agent only lists its owner's boards", async () => {
  const res = await GET(req(LIMITED_KEY));
  assert.equal(res.status, 200);
  const { boards } = await res.json();
  assert.deepEqual(boards.map((b: { id: string }) => b.id), [boardAId]);
});

test("owner-mapped agent gets 404 reading a board outside its owner's access", async () => {
  const okRes = await GET_BOARD(req(LIMITED_KEY), { params: Promise.resolve({ boardId: boardAId }) });
  assert.equal(okRes.status, 200);
  const denied = await GET_BOARD(req(LIMITED_KEY), { params: Promise.resolve({ boardId: boardBId }) });
  assert.equal(denied.status, 404);
});
