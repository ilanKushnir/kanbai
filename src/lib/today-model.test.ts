import assert from "node:assert/strict";
import test from "node:test";
import { buildToday, greetingFor, summaryLine, type TodayNote, type TodayTicket } from "./today-model";

const now = new Date(2026, 9, 13, 9, 0, 0); // Tue Oct 13 2026, local
const board = { id: "b", name: "Personal", slug: "personal", color: "amber", doneColumnId: "done" };

function ticket(p: Partial<TodayTicket> & { id: string }): TodayTicket {
  return {
    title: p.id,
    number: 1,
    priority: "none",
    dueDate: null,
    columnId: "todo",
    columnName: "To Do",
    subState: null,
    completedAt: null,
    isDone: false,
    board,
    labels: [],
    subtasks: [],
    commentCount: 0,
    createdByType: "user",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...p,
  };
}
function note(p: Partial<TodayNote> & { id: string }): TodayNote {
  return {
    body: p.id,
    status: "inbox",
    scheduledDay: null,
    doneOn: null,
    priority: "none",
    position: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
      ticket: null,
    ...p,
  };
}
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test("items land in the right day sections", () => {
  const m = buildToday({
    now,
    tickets: [
      ticket({ id: "t-overdue", dueDate: local(2026, 10, 12) }),
      ticket({ id: "t-today", dueDate: local(2026, 10, 13) }),
      ticket({ id: "t-tomorrow", dueDate: local(2026, 10, 14) }),
      ticket({ id: "t-thu", dueDate: local(2026, 10, 15) }),
      ticket({ id: "t-later", dueDate: local(2026, 10, 25) }),
      ticket({ id: "t-undated" }),
    ],
    notes: [
      note({ id: "n-inbox" }),
      note({ id: "n-today", scheduledDay: "2026-10-13" }),
      note({ id: "n-old", scheduledDay: "2026-10-01" }),
      note({ id: "n-archived", status: "archived", scheduledDay: "2026-10-13" }),
    ],
  });
  const ids = (k: string) => m.sections.find((s) => s.key === k)!.items.map((i) => i.id);
  assert.deepEqual(ids("overdue"), ["n-old", "t-overdue"]);
  assert.deepEqual(ids("today"), ["t-today", "n-today"]);
  assert.deepEqual(ids("tomorrow"), ["t-tomorrow"]);
  assert.deepEqual(ids("week"), ["t-thu"]);
  assert.deepEqual(ids("later"), ["t-later"]);
  assert.deepEqual(ids("inbox"), ["n-inbox"]);
  assert.equal(m.sections.find((s) => s.key === "week")!.groups![0].label, "Thursday");
  assert.equal(m.counts.overdue, 2);
  assert.equal(m.counts.today, 2);
});

test("done today is its own section; done earlier disappears", () => {
  const m = buildToday({
    now,
    tickets: [
      ticket({ id: "t-done-today", isDone: true, completedAt: local(2026, 10, 13, 8), dueDate: local(2026, 10, 13) }),
      ticket({ id: "t-done-yesterday", isDone: true, completedAt: local(2026, 10, 12, 8), dueDate: local(2026, 10, 12) }),
    ],
    notes: [note({ id: "n-done-today", doneOn: "2026-10-13", scheduledDay: "2026-10-10" }), note({ id: "n-done-old", doneOn: "2026-10-11" })],
  });
  const done = m.sections.find((s) => s.key === "done")!.items.map((i) => i.id);
  assert.deepEqual(done, ["n-done-today", "t-done-today"]);
  assert.equal(m.sections.find((s) => s.key === "overdue")!.items.length, 0);
  assert.equal(m.counts.doneToday, 2);
});

test("priority orders within a section", () => {
  const m = buildToday({
    now,
    tickets: [ticket({ id: "low", priority: "low", dueDate: local(2026, 10, 13) }), ticket({ id: "urgent", priority: "urgent", dueDate: local(2026, 10, 13) })],
    notes: [note({ id: "high", priority: "high", scheduledDay: "2026-10-13" })],
  });
  assert.deepEqual(m.sections.find((s) => s.key === "today")!.items.map((i) => i.id), ["urgent", "high", "low"]);
});

test("greeting and summary", () => {
  assert.equal(greetingFor(new Date(2026, 9, 13, 8), "Ilan Kushnir").greeting, "Good morning, Ilan.");
  assert.equal(greetingFor(new Date(2026, 9, 13, 20), null).period, "evening");
  assert.equal(summaryLine({ overdue: 1, today: 2, doneToday: 3, inbox: 0 }), "3 to do · 1 overdue · 3 done");
  assert.equal(summaryLine({ overdue: 0, today: 0, doneToday: 2, inbox: 0 }), "All clear — 2 done today.");
});
