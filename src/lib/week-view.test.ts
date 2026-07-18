import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWeekDays,
  compareWeekTickets,
  dueDayOf,
  groupTicketsByWeekDay,
  startOfWeek,
  weekRangeLabel,
  type WeekViewTicket,
} from "@/lib/week-view";
import { addDays, ymd } from "@/lib/notes-schedule";

type Row = WeekViewTicket;
const row = (over: Partial<Row> & { id: string }): Row => ({
  dueDate: null,
  priority: "none",
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

test("startOfWeek honors the week-start preference", () => {
  const wednesday = new Date(2026, 6, 15, 14, 30); // Wed 2026-07-15, local
  assert.equal(ymd(startOfWeek(wednesday, 0)), "2026-07-12"); // Sunday start
  assert.equal(ymd(startOfWeek(wednesday, 1)), "2026-07-13"); // Monday start
  assert.equal(ymd(startOfWeek(wednesday, 6)), "2026-07-11"); // Saturday start
  // On the week-start day itself, the week starts today — not a week ago.
  const sunday = new Date(2026, 6, 12, 8, 0);
  assert.equal(ymd(startOfWeek(sunday, 0)), "2026-07-12");
});

test("buildWeekDays yields 7 consecutive local days from the start", () => {
  const days = buildWeekDays(startOfWeek(new Date(2026, 6, 15), 1));
  assert.equal(days.length, 7);
  assert.deepEqual(
    days.map((d) => d.ymd),
    ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"],
  );
  // Crosses a month boundary without skipping or repeating a day.
  const wrap = buildWeekDays(startOfWeek(new Date(2026, 6, 1), 0)); // week of Jun 28 – Jul 4
  assert.deepEqual(wrap.map((d) => d.ymd).slice(2, 5), ["2026-06-30", "2026-07-01", "2026-07-02"]);
});

test("weekRangeLabel spans months only when it has to", () => {
  const sameMonth = weekRangeLabel(buildWeekDays(new Date(2026, 6, 13)));
  assert.match(sameMonth, /13.*19/);
  assert.match(sameMonth, /2026/);
  const crossMonth = weekRangeLabel(buildWeekDays(new Date(2026, 5, 29))); // Jun 29 – Jul 5
  assert.match(crossMonth, /29.*5/);
  // The month appears twice when the week straddles a boundary.
  const months = crossMonth.match(/[A-Za-z]+/g) ?? [];
  assert.equal(months.length, 2);
});

test("dueDayOf maps a due instant to its local calendar day", () => {
  assert.equal(dueDayOf({ dueDate: null }), null);
  const noonLocal = new Date(2026, 6, 15, 12, 0).toISOString();
  assert.equal(dueDayOf({ dueDate: noonLocal }), "2026-07-15");
  const lateLocal = new Date(2026, 6, 15, 23, 45).toISOString();
  assert.equal(dueDayOf({ dueDate: lateLocal }), "2026-07-15");
});

test("groupTicketsByWeekDay buckets by day, collects undated, drops out-of-week", () => {
  const days = buildWeekDays(startOfWeek(new Date(2026, 6, 15), 0)).map((d) => d.ymd); // Jul 12–18
  const due = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0).toISOString();
  const tickets = [
    row({ id: "mon", dueDate: due(2026, 6, 13) }),
    row({ id: "wed", dueDate: due(2026, 6, 15) }),
    row({ id: "none", dueDate: null }),
    row({ id: "next-week", dueDate: due(2026, 6, 21) }),
    row({ id: "last-week", dueDate: due(2026, 6, 8) }),
  ];
  const { byDay, unscheduled } = groupTicketsByWeekDay(tickets, days);

  // Every day of the week has a bucket, even when empty.
  assert.deepEqual(Object.keys(byDay), days);
  assert.deepEqual(byDay["2026-07-13"].map((t) => t.id), ["mon"]);
  assert.deepEqual(byDay["2026-07-15"].map((t) => t.id), ["wed"]);
  assert.deepEqual(byDay["2026-07-12"], []);
  assert.deepEqual(unscheduled.map((t) => t.id), ["none"]);
  // Out-of-week dated tickets belong to their own week's view, not this one.
  const placed = new Set([...Object.values(byDay).flat(), ...unscheduled].map((t) => t.id));
  assert.equal(placed.has("next-week"), false);
  assert.equal(placed.has("last-week"), false);
});

test("compareWeekTickets: open before done, then due time, then priority, then createdAt", () => {
  const t = (id: string, over: Partial<Row>) => row({ id, ...over });
  const nineAm = new Date(2026, 6, 15, 9, 0).toISOString();
  const fivePm = new Date(2026, 6, 15, 17, 0).toISOString();

  // Done work sinks below open work whatever its time or priority.
  const doneEarly = t("done", { dueDate: nineAm, priority: "urgent", done: true });
  const openLate = t("open", { dueDate: fivePm, priority: "low" });
  assert.ok(compareWeekTickets(openLate, doneEarly) < 0);

  // Earlier due instant first among open tickets.
  assert.ok(compareWeekTickets(t("a", { dueDate: nineAm }), t("b", { dueDate: fivePm })) < 0);

  // Same instant → higher priority first.
  assert.ok(
    compareWeekTickets(t("hi", { dueDate: nineAm, priority: "high" }), t("lo", { dueDate: nineAm, priority: "low" })) < 0,
  );

  // Undated (unscheduled bucket) → priority decides, createdAt breaks ties.
  assert.ok(compareWeekTickets(t("hi", { priority: "high" }), t("lo", { priority: "low" })) < 0);
  assert.ok(
    compareWeekTickets(
      t("older", { createdAt: "2026-07-01T08:00:00.000Z" }),
      t("newer", { createdAt: "2026-07-02T08:00:00.000Z" }),
    ) < 0,
  );
});

test("a full-day sort is stable and journal-shaped (open by time, done at the bottom)", () => {
  const at = (h: number) => new Date(2026, 6, 15, h, 0).toISOString();
  const dayTickets = [
    row({ id: "done-9", dueDate: at(9), done: true }),
    row({ id: "open-17", dueDate: at(17) }),
    row({ id: "open-9-high", dueDate: at(9), priority: "high" }),
    row({ id: "open-9-low", dueDate: at(9), priority: "low" }),
  ];
  const days = [ymd(new Date(2026, 6, 15))];
  const { byDay } = groupTicketsByWeekDay(dayTickets, days);
  assert.deepEqual(byDay["2026-07-15"].map((t) => t.id), ["open-9-high", "open-9-low", "open-17", "done-9"]);
});

test("week navigation by ±7 days lands on adjacent weeks", () => {
  const start = startOfWeek(new Date(2026, 6, 15), 1); // Mon Jul 13
  assert.equal(ymd(addDays(start, 7)), "2026-07-20");
  assert.equal(ymd(addDays(start, -7)), "2026-07-06");
  // Next week's start is itself a valid week start.
  assert.equal(ymd(startOfWeek(addDays(start, 7), 1)), "2026-07-20");
});
