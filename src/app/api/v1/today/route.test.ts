import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { getAgenda } from "@/lib/services/agenda";
import { GET } from "./route";

// GET /api/v1/today + getAgenda: shape, bucketing, and the timezone day
// boundary (a ticket due 01:30 Jerusalem time on the 14th is "today" at 00:30
// Jerusalem on the 14th even though the host clock still says the 13th UTC).

const KEY = "kbai_live_today_key_000000000000000000";
const TZ = "Asia/Jerusalem";

let wsId: string;
let ownerId: string;
let boardId: string;
let doneColId: string;
let todoColId: string;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.ticket.deleteMany();
  await db.note.deleteMany();
  await db.column.deleteMany();
  await db.agent.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

async function ticket(title: string, columnId: string, extra: Record<string, unknown> = {}) {
  return db.ticket.create({ data: { boardId, columnId, title, number: Math.floor(Math.random() * 1e6), ...extra } });
}

before(async () => {
  await wipe();
  const owner = await db.user.create({ data: { email: "owner@today.test", name: "Ilan" } });
  ownerId = owner.id;
  const ws = await db.workspace.create({
    data: { name: "Today WS", slug: "today-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  wsId = ws.id;
  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Life",
      slug: "life",
      columns: { create: [{ name: "Todo", position: 0 }, { name: "Done", position: 1, isDone: true, stage: "done" }] },
    },
    include: { columns: true },
  });
  boardId = board.id;
  todoColId = board.columns[0].id;
  doneColId = board.columns[1].id;
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "tickets:read" } });

  // "now" = 2026-10-13T21:30:00Z → 00:30 on Oct 14 in Jerusalem (UTC+3).
  await ticket("Overdue", todoColId, { dueDate: new Date("2026-10-13T08:00:00Z") }); // Oct 13 Jerusalem
  await ticket("Late night today", todoColId, { dueDate: new Date("2026-10-13T22:30:00Z") }); // 01:30 Oct 14
  await ticket("Afternoon today", todoColId, { dueDate: new Date("2026-10-14T12:00:00Z") });
  await ticket("Tomorrow", todoColId, { dueDate: new Date("2026-10-15T09:00:00Z") });
  await ticket("Upcoming", todoColId, { dueDate: new Date("2026-10-18T09:00:00Z") });
  await ticket("Far", todoColId, { dueDate: new Date("2026-11-01T09:00:00Z") });
  await ticket("Undated", todoColId);
  await ticket("Done today", doneColId, { completedAt: new Date("2026-10-13T22:00:00Z") }); // 01:00 Oct 14
  await ticket("Done yesterday", doneColId, { completedAt: new Date("2026-10-13T10:00:00Z") });

  const note = (body: string, extra: Record<string, unknown> = {}) =>
    db.note.create({ data: { userId: owner.id, body, ...extra } });
  await note("Unsorted idea");
  await note("Planned for today", { scheduledDay: "2026-10-14" });
  await note("Slipped from yesterday", { scheduledDay: "2026-10-13" });
  await note("Next week", { scheduledDay: "2026-10-20" });
  await note("Ticked off", { scheduledDay: "2026-10-14", doneOn: "2026-10-14" });
  await note("Deleted", { deletedAt: new Date() });
  await note("Archived", { status: "archived" });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
const bodies = (rows: { body: string }[]) => rows.map((r) => r.body);

test("getAgenda buckets by the workspace calendar day, not the host clock", async () => {
  const agenda = await getAgenda({ workspaceId: wsId, userId: ownerId, now: new Date("2026-10-13T21:30:00Z"), timezone: TZ });
  assert.equal(agenda.date, "2026-10-14");
  assert.equal(agenda.timezone, TZ);
  assert.deepEqual(titles(agenda.overdue), ["Overdue"]);
  assert.deepEqual(titles(agenda.today), ["Late night today", "Afternoon today"]);
  assert.deepEqual(titles(agenda.tomorrow), ["Tomorrow"]);
  assert.deepEqual(titles(agenda.upcoming), ["Upcoming"]);
  assert.deepEqual(titles(agenda.doneToday.tickets), ["Done today"]);
  assert.deepEqual(bodies(agenda.inbox), ["Unsorted idea"]);
  assert.deepEqual(bodies(agenda.notesToday), ["Planned for today", "Slipped from yesterday"]);
  assert.deepEqual(bodies(agenda.doneToday.notes), ["Ticked off"]);
  // Every ticket carries board + column context, incl. the done column id.
  const t = agenda.today[0];
  assert.deepEqual({ board: t.board.name, slug: t.board.slug, done: t.board.doneColumnId }, { board: "Life", slug: "life", done: doneColId });
  assert.deepEqual({ name: t.column.name, isDone: t.column.isDone, stage: t.column.stage }, { name: "Todo", isDone: false, stage: "backlog" });
  assert.equal(t.columnName, "Todo");
  assert.equal(typeof t.dueDate, "string");
  // Plain data — survives a JSON round trip unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(agenda)), agenda);
});

test("in UTC the same instant is still the 13th", async () => {
  const agenda = await getAgenda({ workspaceId: wsId, userId: ownerId, now: new Date("2026-10-13T21:30:00Z"), timezone: "UTC" });
  assert.equal(agenda.date, "2026-10-13");
  assert.deepEqual(titles(agenda.overdue), []);
  assert.deepEqual(titles(agenda.today), ["Overdue", "Late night today"]);
  assert.deepEqual(titles(agenda.tomorrow), ["Afternoon today"]);
});

test("scope=mine keeps only the owner's assigned tickets", async () => {
  const agenda = await getAgenda({ workspaceId: wsId, userId: ownerId, now: new Date("2026-10-13T21:30:00Z"), timezone: TZ, scope: "mine" });
  assert.deepEqual(titles(agenda.today), []);
  await db.ticket.updateMany({
    where: { title: "Afternoon today" },
    data: { assigneeType: "user", assigneeUserId: ownerId },
  });
  const mine = await getAgenda({ workspaceId: wsId, userId: ownerId, now: new Date("2026-10-13T21:30:00Z"), timezone: TZ, scope: "mine" });
  assert.deepEqual(titles(mine.today), ["Afternoon today"]);
});

test("GET /today answers for the workspace owner with the documented shape", async () => {
  const res = await GET(new Request("http://test.local/api/v1/today", { headers: { authorization: `Bearer ${KEY}` } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["date", "doneToday", "inbox", "notesToday", "overdue", "timezone", "today", "tomorrow", "upcoming"]);
  assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof body.timezone, "string");
  assert.deepEqual(Object.keys(body.doneToday).sort(), ["notes", "tickets"]);
  assert.deepEqual(bodies(body.inbox), ["Unsorted idea"]);
  const noKey = await GET(new Request("http://test.local/api/v1/today"));
  assert.equal(noKey.status, 401);
});
