import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  buildSchedule,
  compareSectionNotes,
  defaultCollapsedKeys,
  isSectionVisibleNote,
  noteSectionKey,
  reflectionSectionKey,
  dueFromDay,
  ymd,
} from "@/lib/notes-schedule";

type Row = { doneOn: string | null; position: number; createdAt: string };
const row = (over: Partial<Row>): Row => ({ doneOn: null, position: 0, createdAt: "2026-06-21T00:00:00.000Z", ...over });

test("compareSectionNotes keeps chronological order by position then createdAt", () => {
  const a = row({ position: 0, createdAt: "2026-06-21T09:00:00.000Z" });
  const b = row({ position: 1, createdAt: "2026-06-21T08:00:00.000Z" });
  // position wins over createdAt
  assert.ok(compareSectionNotes(a, b) < 0);

  const c = row({ position: 2, createdAt: "2026-06-21T07:00:00.000Z" });
  const d = row({ position: 2, createdAt: "2026-06-21T08:00:00.000Z" });
  // equal position → earlier createdAt first (first added at top)
  assert.ok(compareSectionNotes(c, d) < 0);
});

test("compareSectionNotes sinks done notes to the bottom regardless of position", () => {
  const active = row({ position: 5, doneOn: null });
  const done = row({ position: 0, doneOn: "2026-06-21" });
  // done note has the lower position but must still sort after the active one
  assert.ok(compareSectionNotes(active, done) < 0);
  assert.ok(compareSectionNotes(done, active) > 0);

  // among two done notes, position order is preserved
  const done1 = row({ position: 1, doneOn: "2026-06-21" });
  const done2 = row({ position: 2, doneOn: "2026-06-21" });
  assert.ok(compareSectionNotes(done1, done2) < 0);
});

test("compareSectionNotes produces a stable full ordering via Array.sort", () => {
  const notes = [
    row({ position: 2, doneOn: "2026-06-21" }), // done → bottom
    row({ position: 0, doneOn: null }),
    row({ position: 1, doneOn: null }),
    row({ position: 0, doneOn: "2026-06-21" }), // done → bottom
  ];
  const ordered = notes.slice().sort(compareSectionNotes);
  assert.deepEqual(
    ordered.map((n) => ({ done: n.doneOn != null, position: n.position })),
    [
      { done: false, position: 0 },
      { done: false, position: 1 },
      { done: true, position: 0 },
      { done: true, position: 2 },
    ],
  );
});

test("reflectionSectionKey buckets a due ticket into the right Notes section", () => {
  // A fixed Wednesday with a Sunday week-start.
  const now = new Date(2026, 5, 17, 10, 0, 0); // 2026-06-17, local
  const schedule = buildSchedule(now, 0);
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0).toISOString();

  // due today → "today"
  assert.equal(reflectionSectionKey(schedule, at(2026, 5, 17)), "today");
  // overdue (yesterday) → still "today" (today + anything overdue)
  assert.equal(reflectionSectionKey(schedule, at(2026, 5, 16)), "today");
  // a later day this week → that day's slot
  assert.equal(reflectionSectionKey(schedule, at(2026, 5, 19)), "day:2026-06-19");
  // after next week but before next month → "later_this_month"
  assert.equal(reflectionSectionKey(schedule, at(2026, 5, 29)), "later_this_month");
  // first day of next month → "next_month"
  assert.equal(reflectionSectionKey(schedule, at(2026, 6, 1)), "next_month");
  // beyond next month → "long_term"
  assert.equal(reflectionSectionKey(schedule, at(2026, 7, 5)), "long_term");
});

test("reflectionSectionKey uses the ticket's local calendar day", () => {
  const now = new Date(2026, 5, 17, 10, 0, 0);
  const schedule = buildSchedule(now, 0);
  // dueFromDay gives a local-noon instant for a YYYY-MM-DD; round-trips to the same day.
  const iso = dueFromDay("2026-06-19")!;
  assert.equal(ymd(new Date(iso)), "2026-06-19");
  assert.equal(reflectionSectionKey(schedule, iso), "day:2026-06-19");
});


test("noteSectionKey rolls concrete days forward at midnight", () => {
  const before = buildSchedule(new Date(2026, 5, 20, 23, 59, 0), 0);
  const after = buildSchedule(new Date(2026, 5, 21, 0, 1, 0), 0);

  const tomorrowNote = { scheduledDay: "2026-06-21", bucket: "tomorrow" };
  assert.equal(noteSectionKey(before, tomorrowNote), "day:2026-06-21");
  assert.equal(noteSectionKey(after, tomorrowNote), "today");

  const todayNote = { scheduledDay: "2026-06-20", bucket: "today" };
  assert.equal(noteSectionKey(before, todayNote), "today");
  assert.equal(noteSectionKey(after, todayNote), "today");
});

test("noteSectionKey rolls coarse future buckets back to Unsorted on their boundary", () => {
  const sunday = buildSchedule(new Date(2026, 5, 21, 0, 1, 0), 0);
  assert.equal(noteSectionKey(sunday, { scheduledDay: "2026-06-21", bucket: "next_week" }), "general");

  const firstOfMonth = buildSchedule(new Date(2026, 6, 1, 0, 1, 0), 0);
  assert.equal(noteSectionKey(firstOfMonth, { scheduledDay: "2026-07-01", bucket: "next_month" }), "general");
});


test("notes and due-ticket reflections cover every future schedule boundary", () => {
  const schedule = buildSchedule(new Date(2026, 5, 17, 10, 0, 0), 0);
  const at = (day: string) => dueFromDay(day)!;

  const cases: Array<[string, string]> = [
    ["2026-06-29", "later_this_month"],
    ["2026-07-01", "next_month"],
    ["2026-08-01", "long_term"],
  ];

  for (const [day, section] of cases) {
    assert.equal(noteSectionKey(schedule, { scheduledDay: day, bucket: "next_month" }), section);
    assert.equal(reflectionSectionKey(schedule, at(day)), section);
  }
});

test("later future section labels are present and quiet sections are addressable", () => {
  const schedule = buildSchedule(new Date(2026, 5, 17, 10, 0, 0), 0);
  assert.ok(schedule.sections.some((s) => s.key === "later_this_month" && s.label === "Later this month"));
  assert.ok(schedule.sections.some((s) => s.key === "long_term" && s.label === "Long term"));
  assert.equal(schedule.sections.find((s) => s.day === "2026-06-18")?.label, "Tomorrow");
});

test("isSectionVisibleNote keeps active notes and notes done today, sweeps the rest", () => {
  const today = "2026-06-21";
  // Active notes always occupy their section.
  assert.equal(isSectionVisibleNote({ status: "inbox", doneOn: null }, today), true);
  assert.equal(isSectionVisibleNote({ status: "queued", doneOn: null }, today), true);
  // Done *today* stays in its section (sunk to the bottom).
  assert.equal(isSectionVisibleNote({ status: "inbox", doneOn: today }, today), true);
  // Done on an earlier day is swept out by next-day archival.
  assert.equal(isSectionVisibleNote({ status: "inbox", doneOn: "2026-06-20" }, today), false);
  // Notes that left the inbox (sorted into a ticket, archived) never reappear.
  assert.equal(isSectionVisibleNote({ status: "sorted", doneOn: null }, today), false);
  assert.equal(isSectionVisibleNote({ status: "archived", doneOn: today }, today), false);
});

test("a note done today sinks to the bottom of its own section but stays visible", () => {
  const today = "2026-06-21";
  const schedule = buildSchedule(new Date(2026, 5, 21, 10, 0, 0), 0);
  const make = (over: Partial<{ status: string; doneOn: string | null; scheduledDay: string | null; position: number; createdAt: string }>) => ({
    status: "inbox",
    doneOn: null,
    scheduledDay: today,
    position: 0,
    createdAt: "2026-06-21T08:00:00.000Z",
    ...over,
  });
  const active = make({ position: 1 });
  const doneToday = make({ position: 0, doneOn: today });

  // Both classify into Today...
  assert.equal(noteSectionKey(schedule, active), "today");
  assert.equal(noteSectionKey(schedule, doneToday), "today");
  // ...both are still in play today...
  assert.equal(isSectionVisibleNote(active, today), true);
  assert.equal(isSectionVisibleNote(doneToday, today), true);
  // ...and the done one sorts after the active one despite its lower position.
  assert.deepEqual(
    [active, doneToday].sort(compareSectionNotes).map((n) => n.doneOn != null),
    [false, true],
  );
});

test("a future note done today stays within its future section", () => {
  const today = "2026-06-21";
  const schedule = buildSchedule(new Date(2026, 5, 21, 10, 0, 0), 0);
  const futureDone = { status: "inbox", doneOn: today, scheduledDay: "2026-07-15", bucket: "next_month" };
  assert.equal(isSectionVisibleNote(futureDone, today), true);
  assert.equal(noteSectionKey(schedule, futureDone), "next_month");
});

test("defaultCollapsedKeys opens only Today on a fresh load", () => {
  const schedule = buildSchedule(new Date(2026, 5, 17, 10, 0, 0), 0);
  const collapsed = defaultCollapsedKeys(schedule);

  // Today is the one section open by default.
  assert.equal(collapsed.has("today"), false);
  // Everything else — Unsorted, the synthetic week group, and every future
  // bucket — starts collapsed.
  for (const key of ["general", "this_week", "next_week", "later_this_month", "next_month", "long_term"]) {
    assert.equal(collapsed.has(key), true, `${key} should start collapsed`);
  }
});

test("late in a month the schedule omits later_this_month — consumers must treat it as optional", () => {
  // 2026-07-18 is a Saturday. With a Sunday week start the day slots roll
  // forward through Jul 24, so next week ends Jul 31 and the "later this
  // month" range is empty — buildSchedule omits the section entirely. The UI
  // must not assume it exists (it crashed on exactly this schedule).
  const schedule = buildSchedule(new Date(2026, 6, 18, 10, 0, 0), 0);
  assert.equal(
    schedule.sections.some((s) => s.kind === "later_this_month"),
    false,
    "later_this_month should be omitted when next week reaches the month boundary",
  );

  // Every other kind is still guaranteed present — the UI may rely on those.
  for (const kind of ["general", "today", "next_week", "next_month", "long_term"]) {
    assert.ok(schedule.sections.some((s) => s.kind === kind), `${kind} must always exist`);
  }

  // And no scheduledDay classifies into the missing section: every day for the
  // next two months lands in a container that actually exists.
  const keys = new Set(schedule.sections.map((s) => s.key));
  for (let i = 0; i <= 62; i++) {
    const key = schedule.classify(ymd(addDays(new Date(2026, 6, 18), i)));
    assert.ok(keys.has(key), `day +${i} classified into missing section "${key}"`);
  }
});

test("every section's drop day classifies back into that same section, all year, any week start", () => {
  // The regression this guards: late in a month, "Next month"'s day (the 1st)
  // could classify as next_week/a weekday slot, and "Later this month"'s range
  // could be empty — a dropped note teleported into a different section.
  for (let offset = 0; offset < 365; offset++) {
    const now = new Date(2026, 0, 1 + offset, 12);
    for (const weekStartsOn of [0, 1]) {
      const schedule = buildSchedule(now, weekStartsOn);
      for (const s of schedule.sections) {
        assert.equal(
          schedule.classify(s.day),
          s.key,
          `${now.toDateString()} (week starts ${weekStartsOn}): section ${s.key} day ${s.day} classified as ${schedule.classify(s.day)}`,
        );
      }
    }
  }
});
