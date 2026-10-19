import assert from "node:assert/strict";
import test from "node:test";
import { buildToday, greetingFor, summaryLine, ticketOwnership, type TodayAssignee, type TodayNote, type TodayTicket } from "./today-model";

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

const me = "u-me";
const user = (id: string, name = id): TodayAssignee => ({ type: "user", id, name });
const agent = (id: string, ownerUserId: string | null): TodayAssignee => ({ type: "agent", id, name: id, ownerUserId });

test("ownership: mine, open, or someone else's", () => {
  assert.equal(ticketOwnership(undefined, me), "open");
  assert.equal(ticketOwnership([], me), "open");
  assert.equal(ticketOwnership([user(me)], me), "mine");
  assert.equal(ticketOwnership([user("u-dana"), user(me)], me), "mine");
  assert.equal(ticketOwnership([user("u-dana")], me), "others");
  assert.equal(ticketOwnership([agent("a-mine", me)], me), "mine");
  assert.equal(ticketOwnership([agent("a-shared", null)], me), "open");
  assert.equal(ticketOwnership([agent("a-danas", "u-dana")], me), "others");
});

test("someone else's tickets leave the day for the others shelf", () => {
  const today = local(2026, 10, 13);
  const m = buildToday({
    now,
    meId: me,
    tickets: [
      ticket({ id: "t-mine", dueDate: today, assignees: [user(me)] }),
      ticket({ id: "t-open", dueDate: today, priority: "urgent" }),
      ticket({ id: "t-dana", dueDate: today, assignees: [user("u-dana", "Dana")] }),
      ticket({ id: "t-dana-later", dueDate: local(2026, 10, 20), assignees: [user("u-dana", "Dana")] }),
      ticket({ id: "t-yoni", dueDate: local(2026, 10, 12), assignees: [user("u-yoni", "Yoni")] }),
      ticket({ id: "t-dana-done", isDone: true, completedAt: today, dueDate: today, assignees: [user("u-dana", "Dana")] }),
    ],
    notes: [note({ id: "n-today", scheduledDay: "2026-10-13" })],
  });
  const ids = (k: string) => m.sections.find((s) => s.key === k)!.items.map((i) => i.id);
  // Yours (notes are always yours) before the unclaimed, even an urgent one.
  assert.deepEqual(ids("today").slice(0, 2).sort(), ["n-today", "t-mine"]);
  assert.equal(ids("today")[2], "t-open");
  assert.deepEqual(ids("overdue"), []);
  assert.deepEqual(ids("done"), []);
  assert.equal(m.counts.today, 3);
  assert.equal(m.counts.overdue, 0);
  // Soonest first; grouped by person, busiest first.
  assert.deepEqual(m.others.items.map((i) => i.id), ["t-yoni", "t-dana", "t-dana-later"]);
  assert.deepEqual(m.others.groups.map((g) => [g.assignee.name, g.items.length]), [["Dana", 2], ["Yoni", 1]]);
});

test("without a viewer every ticket stays on the day", () => {
  const m = buildToday({ now, tickets: [ticket({ id: "t-dana", dueDate: local(2026, 10, 13), assignees: [user("u-dana")] })], notes: [] });
  assert.equal(m.counts.today, 1);
  assert.equal(m.others.items.length, 0);
});
