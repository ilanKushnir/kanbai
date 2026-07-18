import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[subtaskId]/route";
import { POST as REORDER } from "./reorder/route";

// Integration tests for the agent subtasks endpoints: CRUD, toggle, reorder,
// and the authorization boundaries (scopes, cross-workspace, and the
// owner-mapped agent whose access is capped to its owner's boards).
// Runs against the throwaway SQLite db set up by the `test` script.

const WRITE_KEY = "kbai_live_sub_write_key_0000000000000";
const READ_KEY = "kbai_live_sub_read_key_00000000000000";
const OTHER_KEY = "kbai_live_sub_other_ws_key_0000000000";
const LIMITED_KEY = "kbai_live_sub_limited_key_00000000000";

type Seed = {
  ticketAId: string; // on board A (limited agent's owner has NO access)
  ticketBId: string; // on board B (limited agent's owner has edit access)
};
let seed: Seed;

function req(key: string | null, method: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  return new Request("http://test.local/api/v1", {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function ctx(ticketId: string, subtaskId?: string) {
  return { params: Promise.resolve({ ticketId, ...(subtaskId ? { subtaskId } : {}) }) } as {
    params: Promise<{ ticketId: string; subtaskId: string }>;
  };
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

  const ws = await db.workspace.create({ data: { name: "Sub WS", slug: "sub-ws" } });
  const otherWs = await db.workspace.create({ data: { name: "Sub Other WS", slug: "sub-other-ws" } });

  // A plain member with access only to board B — owns the LIMITED agent.
  const bob = await db.user.create({ data: { email: "bob@sub.test", name: "Bob" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: bob.id, role: "member" } });

  const boardA = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Board A",
      slug: "board-a",
      columns: { create: [{ name: "To Do", position: 0 }] },
    },
    include: { columns: true },
  });
  const boardB = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Board B",
      slug: "board-b",
      columns: { create: [{ name: "To Do", position: 0 }] },
    },
    include: { columns: true },
  });
  await db.boardAccess.create({ data: { boardId: boardB.id, userId: bob.id, level: "edit" } });

  const ticketA = await db.ticket.create({
    data: { boardId: boardA.id, columnId: boardA.columns[0].id, title: "Ticket A", number: 1 },
  });
  const ticketB = await db.ticket.create({
    data: { boardId: boardB.id, columnId: boardB.columns[0].id, title: "Ticket B", number: 1 },
  });

  await db.agent.create({
    data: { workspaceId: ws.id, name: "Writer", apiKeyHash: hashApiKey(WRITE_KEY), scopes: "tickets:read,tickets:write" },
  });
  await db.agent.create({
    data: { workspaceId: ws.id, name: "Reader", apiKeyHash: hashApiKey(READ_KEY), scopes: "tickets:read" },
  });
  await db.agent.create({
    data: { workspaceId: otherWs.id, name: "Outsider", apiKeyHash: hashApiKey(OTHER_KEY), scopes: "tickets:read,tickets:write" },
  });
  // Owner-mapped agent: acts with Bob's board access (board B only).
  await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "Limited",
      apiKeyHash: hashApiKey(LIMITED_KEY),
      scopes: "tickets:read,tickets:write",
      ownerUserId: bob.id,
    },
  });

  seed = { ticketAId: ticketA.id, ticketBId: ticketB.id };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("POST creates ordered subtasks and returns the full ticket", async () => {
  const res1 = await POST(req(WRITE_KEY, "POST", { title: "First step" }), ctx(seed.ticketAId));
  assert.equal(res1.status, 201);
  const res2 = await POST(req(WRITE_KEY, "POST", { title: "Second step" }), ctx(seed.ticketAId));
  assert.equal(res2.status, 201);
  const { ticket } = await res2.json();
  assert.equal(ticket.subtasks.length, 2);
  assert.deepEqual(
    ticket.subtasks.map((s: { title: string; position: number; completed: boolean }) => [s.title, s.position, s.completed]),
    [["First step", 0, false], ["Second step", 1, false]],
  );
});

test("GET lists a ticket's subtasks in order", async () => {
  const res = await GET(req(WRITE_KEY, "GET"), ctx(seed.ticketAId));
  assert.equal(res.status, 200);
  const { subtasks } = await res.json();
  assert.deepEqual(subtasks.map((s: { title: string }) => s.title), ["First step", "Second step"]);
});

test("PATCH toggles completion and renames", async () => {
  const list = await db.subtask.findMany({ where: { ticketId: seed.ticketAId }, orderBy: { position: "asc" } });
  const done = await PATCH(req(WRITE_KEY, "PATCH", { completed: true }), ctx(seed.ticketAId, list[0].id));
  assert.equal(done.status, 200);
  let { ticket } = await done.json();
  assert.equal(ticket.subtasks[0].completed, true);

  const renamed = await PATCH(req(WRITE_KEY, "PATCH", { title: "First step (renamed)" }), ctx(seed.ticketAId, list[0].id));
  assert.equal(renamed.status, 200);
  ({ ticket } = await renamed.json());
  assert.equal(ticket.subtasks[0].title, "First step (renamed)");
  assert.equal(ticket.subtasks[0].completed, true); // untouched by the rename
});

test("reorder rewrites positions to match orderedIds", async () => {
  const list = await db.subtask.findMany({ where: { ticketId: seed.ticketAId }, orderBy: { position: "asc" } });
  const res = await REORDER(
    req(WRITE_KEY, "POST", { orderedIds: [list[1].id, list[0].id] }),
    ctx(seed.ticketAId),
  );
  assert.equal(res.status, 200);
  const { ticket } = await res.json();
  assert.deepEqual(
    ticket.subtasks.map((s: { id: string }) => s.id),
    [list[1].id, list[0].id],
  );
});

test("reorder with a stale/partial id list → 422", async () => {
  const list = await db.subtask.findMany({ where: { ticketId: seed.ticketAId } });
  const partial = await REORDER(req(WRITE_KEY, "POST", { orderedIds: [list[0].id] }), ctx(seed.ticketAId));
  assert.equal(partial.status, 422);
  const foreign = await REORDER(
    req(WRITE_KEY, "POST", { orderedIds: [list[0].id, "sub_missing"] }),
    ctx(seed.ticketAId),
  );
  assert.equal(foreign.status, 422);
});

test("DELETE removes the subtask and closes the position gap", async () => {
  const list = await db.subtask.findMany({ where: { ticketId: seed.ticketAId }, orderBy: { position: "asc" } });
  const res = await DELETE(req(WRITE_KEY, "DELETE"), ctx(seed.ticketAId, list[0].id));
  assert.equal(res.status, 200);
  const { ticket } = await res.json();
  assert.equal(ticket.subtasks.length, 1);
  assert.equal(ticket.subtasks[0].position, 0);
});

test("a subtask can't be addressed through a different ticket → 404", async () => {
  const other = await POST(req(WRITE_KEY, "POST", { title: "On ticket B" }), ctx(seed.ticketBId));
  assert.equal(other.status, 201);
  const sub = await db.subtask.findFirst({ where: { ticketId: seed.ticketBId } });
  const res = await PATCH(req(WRITE_KEY, "PATCH", { completed: true }), ctx(seed.ticketAId, sub!.id));
  assert.equal(res.status, 404);
});

test("empty title → 422; empty PATCH body → 422", async () => {
  const created = await POST(req(WRITE_KEY, "POST", { title: "   " }), ctx(seed.ticketAId));
  assert.equal(created.status, 422);
  const sub = await db.subtask.findFirst({ where: { ticketId: seed.ticketAId } });
  const patched = await PATCH(req(WRITE_KEY, "PATCH", {}), ctx(seed.ticketAId, sub!.id));
  assert.equal(patched.status, 422);
});

test("missing token → 401; read-only scope can GET but not POST", async () => {
  assert.equal((await POST(req(null, "POST", { title: "x" }), ctx(seed.ticketAId))).status, 401);
  assert.equal((await GET(req(READ_KEY, "GET"), ctx(seed.ticketAId))).status, 200);
  const res = await POST(req(READ_KEY, "POST", { title: "x" }), ctx(seed.ticketAId));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "missing_scope");
});

test("agent from another workspace → 404", async () => {
  const res = await POST(req(OTHER_KEY, "POST", { title: "x" }), ctx(seed.ticketAId));
  assert.equal(res.status, 404);
});

test("owner-mapped agent is capped to its owner's boards", async () => {
  // Bob has no access to board A → its ticket is invisible to the Limited agent.
  const denied = await POST(req(LIMITED_KEY, "POST", { title: "nope" }), ctx(seed.ticketAId));
  assert.equal(denied.status, 404);
  assert.equal((await GET(req(LIMITED_KEY, "GET"), ctx(seed.ticketAId))).status, 404);
  // Board B is granted → full subtask powers there.
  const allowed = await POST(req(LIMITED_KEY, "POST", { title: "ok on B" }), ctx(seed.ticketBId));
  assert.equal(allowed.status, 201);
});
