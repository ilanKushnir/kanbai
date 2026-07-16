import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMyDayDoneArchive,
  buildMyDayFocusItems,
  buildMyDayQueue,
  countMyDayUnsortedNotes,
  type MyDayNote,
  type MyDayTicket,
} from "@/lib/my-day";

const today = "2026-06-21";
const todayNoon = new Date(2026, 5, 21, 12, 0, 0);

const note = (over: Partial<MyDayNote>): MyDayNote => ({
  id: "note-1",
  body: "Scheduled regular note",
  status: "inbox",
  scheduledDay: today,
  bucket: "today",
  doneOn: null,
  position: 0,
  createdAt: "2026-06-21T08:00:00.000Z",
  ...over,
});

const ticket = (over: Partial<MyDayTicket>): MyDayTicket => ({
  id: "ticket-1",
  dueDate: new Date(2026, 5, 21, 9, 0, 0).toISOString(),
  priority: "medium",
  assignee: null,
  ...over,
});

test("My Day focus includes regular notes scheduled for today alongside due tickets", () => {
  const items = buildMyDayFocusItems({
    now: todayNoon,
    notes: [
      note({ id: "today-note", body: "Do today" }),
      note({ id: "unsorted-note", scheduledDay: null, bucket: "general" }),
      note({ id: "future-note", scheduledDay: "2026-06-22", bucket: "tomorrow" }),
      note({ id: "queued-note", status: "queued" }),
    ],
    tickets: [ticket({ id: "due-ticket" })],
    userId: "user-1",
  });

  assert.deepEqual(
    items.map((item) => `${item.kind}:${item.id}`),
    ["ticket:due-ticket", "note:today-note"],
  );
});

test("My Day unsorted count matches Notes general section and excludes undated tickets", () => {
  const notes: MyDayNote[] = [
    note({ id: "unsorted-active", scheduledDay: null, bucket: "general" }),
    note({ id: "unsorted-done-today", scheduledDay: null, bucket: "general", doneOn: today }),
    note({ id: "scheduled-today", scheduledDay: today, bucket: "today" }),
    note({ id: "archived", scheduledDay: null, bucket: "general", status: "archived" }),
  ];
  const tickets: MyDayTicket[] = [ticket({ id: "undated-ticket", dueDate: null })];

  assert.equal(countMyDayUnsortedNotes({ now: todayNoon, notes, tickets }), 2);
});


test("My Day excludes items completed before today from the active focus lane", () => {
  const yesterday = "2026-06-20";
  const items = buildMyDayFocusItems({
    now: todayNoon,
    notes: [
      note({ id: "done-yesterday", doneOn: yesterday }),
      note({ id: "done-today", doneOn: today }),
    ],
    tickets: [
      ticket({ id: "open-ticket" }),
    ],
    userId: "user-1",
  });

  assert.deepEqual(
    items.map((item) => `${item.kind}:${item.id}`),
    ["ticket:open-ticket", "note:done-today"],
  );
});

test("My Day queue splits overdue / today / anytime and keeps done-today notes out of the lane", () => {
  const queue = buildMyDayQueue({
    now: todayNoon,
    notes: [
      note({ id: "today-note" }),
      note({ id: "done-today-note", doneOn: today }), // archived surface, not the queue
      note({ id: "future-note", scheduledDay: "2026-06-22", bucket: "tomorrow" }),
    ],
    tickets: [
      ticket({ id: "overdue-ticket", dueDate: new Date(2026, 5, 19, 9, 0, 0).toISOString() }),
      ticket({ id: "today-ticket" }),
      ticket({ id: "week-ticket", dueDate: new Date(2026, 5, 24, 9, 0, 0).toISOString() }),
      ticket({ id: "mine-ticket", dueDate: null, assignee: { type: "user", id: "user-1" } }),
      ticket({ id: "someone-elses", dueDate: null, assignee: { type: "user", id: "user-2" } }),
    ],
    userId: "user-1",
  });

  assert.deepEqual(queue.overdue.map((i) => `${i.kind}:${i.id}:${i.urgent}`), ["ticket:overdue-ticket:true"]);
  assert.deepEqual(queue.today.map((i) => `${i.kind}:${i.id}`), ["ticket:today-ticket", "note:today-note"]);
  assert.deepEqual(queue.anytime.map((i) => `${i.kind}:${i.id}`), ["ticket:mine-ticket"]);
});

test("My Day groups completed tickets and notes by completion day, collapsed and initially limited", () => {
  const archive = buildMyDayDoneArchive({
    now: todayNoon,
    limit: 2,
    notes: [
      note({ id: "note-today", doneOn: today }),
      note({ id: "note-yesterday", doneOn: "2026-06-20" }),
      note({ id: "note-old", doneOn: "2026-06-01" }),
    ],
    tickets: [
      { ...ticket({ id: "ticket-yesterday" }), completedOn: "2026-06-20" },
      { ...ticket({ id: "ticket-old" }), completedOn: "2026-06-01" },
    ],
  });

  assert.equal(archive.collapsedByDefault, true);
  assert.equal(archive.total, 5);
  assert.equal(archive.hasMore, true);
  assert.deepEqual(archive.groups.map((group) => group.key), ["2026-06-21", "2026-06-20"]);
  assert.deepEqual(archive.groups.flatMap((group) => group.items.map((item) => `${item.kind}:${item.id}`)), [
    "note:note-today",
    "ticket:ticket-yesterday",
    "note:note-yesterday",
  ]);
});
