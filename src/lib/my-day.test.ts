import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMyDayCompletionSeries,
  buildMyDayDoneArchive,
  buildMyDayEchoes,
  buildMyDayFocusItems,
  buildMyDayQueue,
  buildMyDayTomorrowRadar,
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
      note({ id: "anytime-note", scheduledDay: null, bucket: "general", position: 2 }),
      note({ id: "done-anytime-note", scheduledDay: null, bucket: "general", doneOn: today, position: 3 }),
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
  assert.deepEqual(queue.anytime.map((i) => `${i.kind}:${i.id}`), ["ticket:mine-ticket", "note:anytime-note"]);
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

test("buildMyDayCompletionSeries yields a dense, oldest-first window ending today", () => {
  const series = buildMyDayCompletionSeries({
    now: todayNoon,
    days: 14,
    tickets: [
      { ...ticket({ id: "t-today" }), completedOn: today },
      { ...ticket({ id: "t-today-2" }), completedOn: today },
      { ...ticket({ id: "t-mid" }), completedOn: "2026-06-15" },
      { ...ticket({ id: "t-outside" }), completedOn: "2026-06-01" },
      { ...ticket({ id: "t-open" }), completedOn: null },
    ],
    notes: [
      note({ id: "n-today", doneOn: today }),
      note({ id: "n-mid", doneOn: "2026-06-15" }),
      note({ id: "n-open", doneOn: null }),
    ],
  });

  assert.equal(series.length, 14);
  assert.equal(series[0].day, "2026-06-08");
  assert.equal(series[13].day, today);
  // No gaps: every consecutive pair is one calendar day apart.
  for (let i = 1; i < series.length; i++) {
    assert.ok(series[i - 1].day < series[i].day);
  }
  assert.deepEqual(series[13], { day: today, tickets: 2, notes: 1 });
  assert.deepEqual(series[7], { day: "2026-06-15", tickets: 1, notes: 1 });
  // Outside the window and still-open items are not counted anywhere.
  const total = series.reduce((n, p) => n + p.tickets + p.notes, 0);
  assert.equal(total, 5);
});

test("buildMyDayEchoes keeps only items completed today, tickets newest-first then notes", () => {
  const echoes = buildMyDayEchoes({
    now: todayNoon,
    tickets: [
      { ...ticket({ id: "t-morning" }), completedOn: today, completedAt: "2026-06-21T08:30:00.000Z" },
      { ...ticket({ id: "t-latest" }), completedOn: today, completedAt: "2026-06-21T11:45:00.000Z" },
      { ...ticket({ id: "t-yesterday" }), completedOn: "2026-06-20", completedAt: "2026-06-20T10:00:00.000Z" },
      { ...ticket({ id: "t-open" }), completedOn: null },
    ],
    notes: [
      note({ id: "n-done-today", doneOn: today }),
      note({ id: "n-done-yesterday", doneOn: "2026-06-20" }),
      note({ id: "n-open" }),
    ],
  });

  assert.equal(echoes.total, 3);
  assert.equal(echoes.ticketCount, 2);
  assert.equal(echoes.noteCount, 1);
  assert.deepEqual(
    [...echoes.peek, ...echoes.rest].map((item) => `${item.kind}:${item.id}`),
    ["ticket:t-latest", "ticket:t-morning", "note:n-done-today"],
  );
});

test("buildMyDayEchoes splits a compact peek from the expandable rest", () => {
  const echoes = buildMyDayEchoes({
    now: todayNoon,
    peek: 2,
    tickets: [],
    notes: [
      note({ id: "n-1", doneOn: today, position: 0 }),
      note({ id: "n-2", doneOn: today, position: 1 }),
      note({ id: "n-3", doneOn: today, position: 2 }),
    ],
  });

  assert.deepEqual(echoes.peek.map((item) => item.id), ["n-1", "n-2"]);
  assert.deepEqual(echoes.rest.map((item) => item.id), ["n-3"]);
  assert.equal(echoes.total, 3);
});

test("buildMyDayTomorrowRadar picks tomorrow's tickets (due time, then priority) before tomorrow's open notes", () => {
  const radar = buildMyDayTomorrowRadar({
    now: todayNoon,
    tickets: [
      ticket({ id: "t-late", dueDate: new Date(2026, 5, 22, 16, 0, 0).toISOString(), priority: "high" }),
      ticket({ id: "t-early", dueDate: new Date(2026, 5, 22, 9, 0, 0).toISOString(), priority: "low" }),
      ticket({ id: "t-today" }),
      ticket({ id: "t-next-week", dueDate: new Date(2026, 5, 26, 9, 0, 0).toISOString() }),
      ticket({ id: "t-undated", dueDate: null }),
    ],
    notes: [
      note({ id: "n-tomorrow", scheduledDay: "2026-06-22", bucket: "tomorrow" }),
      note({ id: "n-today" }),
      note({ id: "n-general", scheduledDay: null, bucket: "general" }),
    ],
  });

  assert.equal(radar.day, "2026-06-22");
  assert.equal(radar.ticketCount, 2);
  assert.equal(radar.noteCount, 1);
  assert.deepEqual(
    [...radar.peek, ...radar.rest].map((item) => `${item.kind}:${item.id}`),
    ["ticket:t-early", "ticket:t-late", "note:n-tomorrow"],
  );
});

test("buildMyDayTomorrowRadar keeps done and inactive items off the radar", () => {
  const tomorrow = "2026-06-22";
  const radar = buildMyDayTomorrowRadar({
    now: todayNoon,
    tickets: [
      // A completed ticket must never resurface as upcoming work, even if its due day is tomorrow.
      { ...ticket({ id: "t-done", dueDate: new Date(2026, 5, 22, 9, 0, 0).toISOString() }), completedOn: today },
    ],
    notes: [
      note({ id: "n-done-tomorrow", scheduledDay: tomorrow, bucket: "tomorrow", doneOn: today }),
      note({ id: "n-queued", scheduledDay: tomorrow, bucket: "tomorrow", status: "queued" }),
      note({ id: "n-archived", scheduledDay: tomorrow, bucket: "tomorrow", status: "archived" }),
    ],
  });

  assert.equal(radar.total, 0);
  assert.deepEqual(radar.peek, []);
  assert.deepEqual(radar.rest, []);
});

test("buildMyDayCompletionSeries zero-fills days with no completions", () => {
  const series = buildMyDayCompletionSeries({ now: todayNoon, days: 3, tickets: [], notes: [] });
  assert.deepEqual(series, [
    { day: "2026-06-19", tickets: 0, notes: 0 },
    { day: "2026-06-20", tickets: 0, notes: 0 },
    { day: "2026-06-21", tickets: 0, notes: 0 },
  ]);
});
