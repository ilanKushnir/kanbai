import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, eventDays, eventsByDay, monthWeeks, weekDays, type PlanColumn } from "./plan-model";
import { ymd } from "./notes-schedule";
import type { TodayNote, TodayTicket } from "./today-model";

const NOW = new Date(2026, 9, 17, 10); // Sat Oct 17 2026, local

function note(id: string, scheduledDay: string | null, doneOn: string | null = null): TodayNote {
  return { id, body: id, status: "inbox", scheduledDay, doneOn, priority: "none", position: 0, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ticket: null };
}
function ticket(id: string, due: Date | null, columnId: string, isDone = false): TodayTicket {
  return {
    id, title: id, number: 1, priority: "medium", dueDate: due ? due.toISOString() : null, columnId, columnName: "", subState: null,
    completedAt: isDone ? NOW.toISOString() : null, isDone, board: { id: "b", name: "B", slug: "b", color: "blue", doneColumnId: "done" },
    labels: [], subtasks: [], commentCount: 0, createdByType: "user", createdAt: "2026-10-01T00:00:00Z",
  };
}
const columns = new Map<string, PlanColumn>([
  ["ideas", { id: "ideas", name: "Ideas", isDone: false, stage: "intake" }],
  ["backlog", { id: "backlog", name: "Backlog", isDone: false, stage: "backlog" }],
  ["work", { id: "work", name: "In Work", isDone: false, stage: "active" }],
  ["done", { id: "done", name: "Done", isDone: true, stage: "done" }],
]);

test("tray: undated and overdue open work; days hold everything dated", () => {
  const plan = buildPlan({
    now: NOW,
    columns,
    tasks: [note("meat", null), note("bank", "2026-10-20"), note("late", "2026-10-10"), note("finished", null, "2026-10-16")],
    tickets: [
      ticket("idea", null, "ideas"),
      ticket("wip", null, "work"),
      ticket("todo", null, "backlog"),
      ticket("slipped", new Date(2026, 9, 12, 12), "backlog"),
      ticket("shipped", new Date(2026, 9, 14, 12), "done", true),
    ],
  });
  assert.deepEqual(plan.tray.tasks.undated.map((i) => i.id), ["meat"]);
  assert.deepEqual(plan.tray.tasks.overdue.map((i) => i.id), ["late"]);
  assert.deepEqual(plan.tray.tickets.undated.map((i) => i.id), ["wip", "todo", "idea"]); // in work → backlog → ideas
  assert.deepEqual(plan.tray.tickets.overdue.map((i) => i.id), ["slipped"]);
  assert.deepEqual(plan.itemsByDay.get("2026-10-20")?.map((i) => i.id), ["bank"]);
  assert.deepEqual(plan.itemsByDay.get("2026-10-16")?.map((i) => i.id), ["finished"]); // done, never scheduled → its done day
  assert.deepEqual(plan.itemsByDay.get("2026-10-14")?.map((i) => i.id), ["shipped"]);
});

test("month grid covers the month in whole weeks from the chosen first weekday", () => {
  const sun = monthWeeks(NOW, 0);
  assert.equal(ymd(sun[0][0]), "2026-09-27");
  assert.equal(ymd(sun.at(-1)!.at(-1)!), "2026-10-31");
  const mon = monthWeeks(NOW, 1);
  assert.equal(ymd(mon[0][0]), "2026-09-28");
  assert.equal(ymd(mon.at(-1)!.at(-1)!), "2026-11-01");
  assert.deepEqual(weekDays(NOW, 0).map(ymd), ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
});

test("events spread over their days, all-day first, then by time", () => {
  assert.deepEqual(eventDays({ id: "a", feedId: "f", title: "Trip", allDay: true, startDay: "2026-10-15", endDay: "2026-10-17" }), ["2026-10-15", "2026-10-16", "2026-10-17"]);
  const start = new Date(2026, 9, 15, 23).toISOString();
  const end = new Date(2026, 9, 16, 0).toISOString(); // ends exactly at midnight → one day
  assert.deepEqual(eventDays({ id: "b", feedId: "f", title: "Late", allDay: false, start, end }), ["2026-10-15"]);
  const map = eventsByDay([
    { id: "b", feedId: "f", title: "Late", allDay: false, start, end },
    { id: "a", feedId: "f", title: "Trip", allDay: true, startDay: "2026-10-15", endDay: "2026-10-17" },
  ]);
  assert.deepEqual(map.get("2026-10-15")?.map((e) => e.id), ["a", "b"]);
});
