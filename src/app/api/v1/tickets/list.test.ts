import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { endOfDayInTz, startOfDayInTz, todayYmd, workspaceTz, addDaysYmd } from "@/lib/tz";
import { GET } from "./route";

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) assert.fail(`expected ${status}, got ${res.status}: ${await res.text()}`);
}

// GET /api/v1/tickets — cross-board listing with status / due / assigned / q /
// boardId / limit filters, board+column context on every row, and the
// owner-mapped access cap. Runs against the throwaway SQLite test db.

const FULL_KEY = "kbai_live_list_full_key_000000000000000";
const LIMITED_KEY = "kbai_live_list_limited_key_00000000000";

let boardA: string;
let boardB: string;
let doneColA: string;
let bobId: string;
let agentId: string;
const ids: Record<string, string> = {};

function req(query: string, key = FULL_KEY) {
  return new Request(`http://test.local/api/v1/tickets${query}`, { headers: { authorization: `Bearer ${key}` } });
}

async function list(query: string, key = FULL_KEY) {
  const res = await GET(req(query, key));
  await expectStatus(res, 200);
  const { tickets } = await res.json();
  return tickets as { id: string; title: string; board: { id: string; doneColumnId: string | null }; column: { name: string; isDone: boolean } }[];
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
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
  const ws = await db.workspace.create({ data: { name: "List WS", slug: "list-ws" } });
  const bob = await db.user.create({ data: { email: "bob@list.test", name: "Bob" } });
  bobId = bob.id;
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: bob.id, role: "member" } });

  const a = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Alpha",
      slug: "alpha",
      columns: { create: [{ name: "Todo", position: 0 }, { name: "Done", position: 1, isDone: true, stage: "done" }] },
    },
    include: { columns: true },
  });
  const b = await db.board.create({
    data: { workspaceId: ws.id, name: "Beta", slug: "beta", columns: { create: [{ name: "Open", position: 0 }] } },
    include: { columns: true },
  });
  boardA = a.id;
  boardB = b.id;
  const todoA = a.columns[0].id;
  doneColA = a.columns[1].id;
  await db.boardAccess.create({ data: { boardId: b.id, userId: bob.id, level: "edit" } });

  const agent = await db.agent.create({
    data: { workspaceId: ws.id, name: "Lister", apiKeyHash: hashApiKey(FULL_KEY), scopes: "tickets:read" },
  });
  agentId = agent.id;
  await db.agent.create({
    data: { workspaceId: ws.id, name: "Limited", apiKeyHash: hashApiKey(LIMITED_KEY), scopes: "tickets:read", ownerUserId: bob.id },
  });

  const tz = workspaceTz();
  const today = todayYmd(tz);
  const mid = (day: string) => new Date((startOfDayInTz(day, tz).getTime() + endOfDayInTz(day, tz).getTime()) / 2);
  const rows: { title: string; boardId: string; columnId: string; dueDate?: Date | null; assignee?: "bob" | "agent" }[] = [
    { title: "Overdue thing", boardId: boardA, columnId: todoA, dueDate: mid(addDaysYmd(today, -2)) },
    { title: "Due today", boardId: boardA, columnId: todoA, dueDate: mid(today), assignee: "bob" },
    { title: "Due tomorrow", boardId: boardA, columnId: todoA, dueDate: mid(addDaysYmd(today, 1)) },
    { title: "Due in five days", boardId: boardA, columnId: todoA, dueDate: mid(addDaysYmd(today, 5)), assignee: "agent" },
    { title: "Due next month", boardId: boardA, columnId: todoA, dueDate: mid(addDaysYmd(today, 30)) },
    { title: "No date", boardId: boardA, columnId: todoA, dueDate: null },
    { title: "Finished", boardId: boardA, columnId: doneColA, dueDate: mid(today) },
    { title: "Beta task", boardId: boardB, columnId: b.columns[0].id, dueDate: mid(today) },
  ];
  let n = 0;
  for (const r of rows) {
    const t = await db.ticket.create({
      data: {
        boardId: r.boardId,
        columnId: r.columnId,
        number: ++n,
        title: r.title,
        dueDate: r.dueDate ?? null,
        ...(r.assignee === "bob"
          ? { assigneeType: "user", assigneeUserId: bob.id, assignees: { create: [{ userId: bob.id, position: 0 }] } }
          : r.assignee === "agent"
            ? { assigneeType: "agent", assigneeAgentId: agent.id }
            : {}),
      },
    });
    ids[r.title] = t.id;
  }
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("default lists open tickets across all boards with board + column context", async () => {
  const rows = await list("");
  assert.deepEqual(titles(rows), ["Beta task", "Due in five days", "Due next month", "Due today", "Due tomorrow", "No date", "Overdue thing"]);
  const t = rows.find((r) => r.title === "Due today")!;
  assert.equal(t.board.id, boardA);
  assert.equal(t.board.doneColumnId, doneColA);
  assert.deepEqual({ name: t.column.name, isDone: t.column.isDone }, { name: "Todo", isDone: false });
  // Soonest due first; undated last.
  assert.equal(rows[0].title, "Overdue thing");
  assert.equal(rows[rows.length - 1].title, "No date");
});

test("status=done / status=all", async () => {
  assert.deepEqual(titles(await list("?status=done")), ["Finished"]);
  assert.equal((await list("?status=all")).length, 8);
});

test("due filters follow the workspace day", async () => {
  assert.deepEqual(titles(await list("?due=overdue")), ["Overdue thing"]);
  assert.deepEqual(titles(await list("?due=today")), ["Beta task", "Due today"]);
  assert.deepEqual(titles(await list("?due=tomorrow")), ["Due tomorrow"]);
  assert.deepEqual(titles(await list("?due=week")), ["Beta task", "Due in five days", "Due today", "Due tomorrow"]);
  assert.deepEqual(titles(await list("?due=none")), ["No date"]);
});

test("boardId, q and limit narrow the list", async () => {
  assert.deepEqual(titles(await list(`?boardId=${boardB}`)), ["Beta task"]);
  assert.deepEqual(titles(await list("?q=DUE")), ["Due in five days", "Due next month", "Due today", "Due tomorrow", "Overdue thing"]);
  assert.deepEqual(titles(await list("?q=five")), ["Due in five days"]);
  assert.equal((await list("?limit=2")).length, 2);
  const bad = await GET(req("?status=bogus"));
  assert.equal(bad.status, 422);
});

test("assigned=me|unassigned|<userId>", async () => {
  assert.deepEqual(titles(await list("?assigned=me")), ["Due in five days"]); // the agent itself
  assert.deepEqual(titles(await list(`?assigned=${bobId}`)), ["Due today"]);
  assert.deepEqual(titles(await list(`?assigned=${agentId}`)), ["Due in five days"]);
  assert.deepEqual(titles(await list("?assigned=unassigned")), ["Beta task", "Due next month", "Due tomorrow", "No date", "Overdue thing"]);
});

test("an owner-mapped agent only sees its owner's boards; assigned=me includes the owner", async () => {
  assert.deepEqual(titles(await list("?status=all", LIMITED_KEY)), ["Beta task"]);
  const denied = await GET(req(`?boardId=${boardA}`, LIMITED_KEY));
  assert.equal(denied.status, 404);
  // Bob owns Limited; "me" = Limited or Bob — Bob's ticket sits on board A, out of reach.
  assert.deepEqual(titles(await list("?assigned=me", LIMITED_KEY)), []);
});
