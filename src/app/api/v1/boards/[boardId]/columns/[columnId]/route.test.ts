import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { GET, PATCH } from "./route";

// Integration tests for the agent-authenticated column management endpoint.
// Run against a throwaway SQLite db (DATABASE_URL is set by the `test` script).
// We drive the exported route handlers directly with hand-built Requests.

const WRITE_KEY = "kbai_live_test_write_key_000000000000";
const READ_KEY = "kbai_live_test_read_key_0000000000000";
const DISABLED_KEY = "kbai_live_test_disabled_key_000000000";
const OTHER_KEY = "kbai_live_test_other_ws_key_0000000000";

type Seed = {
  boardId: string;
  otherBoardId: string;
  todoColumnId: string;
  doneColumnId: string;
  otherColumnId: string;
};

let seed: Seed;

function req(key: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  return new Request("http://test.local/api/v1", {
    method: body === undefined ? "GET" : "PATCH",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function ctx(boardId: string, columnId: string) {
  return { params: Promise.resolve({ boardId, columnId }) };
}

async function wipe() {
  await db.activityLog.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.agent.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
}

before(async () => {
  await wipe();

  const ws = await db.workspace.create({ data: { name: "Test WS", slug: "test-ws" } });
  const otherWs = await db.workspace.create({ data: { name: "Other WS", slug: "other-ws" } });

  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Roadmap",
      slug: "roadmap",
      columns: {
        create: [
          { name: "To Do", position: 0 },
          { name: "Done", position: 1, isDone: true },
        ],
      },
    },
    include: { columns: { orderBy: { position: "asc" } } },
  });

  // A column on a different board (same workspace) — used to prove the column
  // must belong to the *addressed* board.
  const otherBoard = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Other Board",
      slug: "other-board",
      columns: { create: [{ name: "Inbox", position: 0 }] },
    },
    include: { columns: true },
  });

  await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "Writer",
      apiKeyHash: hashApiKey(WRITE_KEY),
      scopes: "boards:read,boards:write",
    },
  });
  await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "Reader",
      apiKeyHash: hashApiKey(READ_KEY),
      scopes: "boards:read",
    },
  });
  await db.agent.create({
    data: {
      workspaceId: ws.id,
      name: "Disabled",
      status: "disabled",
      apiKeyHash: hashApiKey(DISABLED_KEY),
      scopes: "boards:read,boards:write",
    },
  });
  // Agent in a *different* workspace — must not reach this board's columns.
  await db.agent.create({
    data: {
      workspaceId: otherWs.id,
      name: "Outsider",
      apiKeyHash: hashApiKey(OTHER_KEY),
      scopes: "boards:read,boards:write",
    },
  });

  seed = {
    boardId: board.id,
    otherBoardId: otherBoard.id,
    todoColumnId: board.columns[0].id,
    doneColumnId: board.columns[1].id,
    otherColumnId: otherBoard.columns[0].id,
  };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("PATCH renames a column and sets sub-states (with readback)", async () => {
  const res = await PATCH(
    req(WRITE_KEY, { name: "In Review", subStates: ["Waiting", "Blocked"] }),
    ctx(seed.boardId, seed.todoColumnId),
  );
  assert.equal(res.status, 200);
  const { column } = await res.json();
  assert.equal(column.name, "In Review");
  assert.deepEqual(column.subStates, ["Waiting", "Blocked"]);

  // Readback via GET reflects the persisted change.
  const get = await GET(req(WRITE_KEY), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(get.status, 200);
  const back = await get.json();
  assert.equal(back.column.name, "In Review");
  assert.deepEqual(back.column.subStates, ["Waiting", "Blocked"]);
});

test("PATCH can flip the done-flag and clear sub-states with []", async () => {
  const res = await PATCH(
    req(WRITE_KEY, { isDone: true, subStates: [] }),
    ctx(seed.boardId, seed.todoColumnId),
  );
  assert.equal(res.status, 200);
  const { column } = await res.json();
  assert.equal(column.isDone, true);
  assert.deepEqual(column.subStates, []);
});

test("sub-states are normalized: trimmed, de-duped case-insensitively", async () => {
  const res = await PATCH(
    req(WRITE_KEY, { subStates: ["  Blocked  ", "blocked", "Waiting"] }),
    ctx(seed.boardId, seed.doneColumnId),
  );
  assert.equal(res.status, 200);
  const { column } = await res.json();
  assert.deepEqual(column.subStates, ["Blocked", "Waiting"]);
});


test("duplicate column name on the same board → 409", async () => {
  const res = await PATCH(req(WRITE_KEY, { name: "Done" }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "column_name_conflict");
});

test("missing token → 401", async () => {
  const res = await PATCH(req(null, { name: "x" }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 401);
});

test("invalid key → 401", async () => {
  const res = await PATCH(req("kbai_live_nope", { name: "x" }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 401);
});

test("disabled agent → 403", async () => {
  const res = await PATCH(req(DISABLED_KEY, { name: "x" }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 403);
});

test("agent missing boards:write scope → 403", async () => {
  const res = await PATCH(req(READ_KEY, { name: "x" }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, "missing_scope");
});

test("read-only agent can still GET a column", async () => {
  const res = await GET(req(READ_KEY), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 200);
});

test("board in another workspace → 404", async () => {
  const res = await PATCH(req(OTHER_KEY, { name: "x" }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 404);
});

test("nonexistent board → 404", async () => {
  const res = await PATCH(req(WRITE_KEY, { name: "x" }), ctx("brd_missing", seed.todoColumnId));
  assert.equal(res.status, 404);
});

test("column that belongs to a different board → 404", async () => {
  const res = await PATCH(
    req(WRITE_KEY, { name: "x" }),
    ctx(seed.boardId, seed.otherColumnId),
  );
  assert.equal(res.status, 404);
});

test("empty PATCH body → 422 (no silent no-op)", async () => {
  const res = await PATCH(req(WRITE_KEY, {}), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 422);
});

test("empty column name → 422", async () => {
  const res = await PATCH(req(WRITE_KEY, { name: "   " }), ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 422);
});

test("too many sub-states → 422", async () => {
  const res = await PATCH(
    req(WRITE_KEY, { subStates: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }),
    ctx(seed.boardId, seed.todoColumnId),
  );
  assert.equal(res.status, 422);
});

test("malformed JSON body → 400", async () => {
  const bad = new Request("http://test.local/api/v1", {
    method: "PATCH",
    headers: { authorization: `Bearer ${WRITE_KEY}`, "content-type": "application/json" },
    body: "{not json",
  });
  const res = await PATCH(bad, ctx(seed.boardId, seed.todoColumnId));
  assert.equal(res.status, 400);
});
