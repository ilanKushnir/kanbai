import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSchedule,
  compareSectionNotes,
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
  // well into next month → "next_month"
  assert.equal(reflectionSectionKey(schedule, at(2026, 7, 5)), "next_month");
});

test("reflectionSectionKey uses the ticket's local calendar day", () => {
  const now = new Date(2026, 5, 17, 10, 0, 0);
  const schedule = buildSchedule(now, 0);
  // dueFromDay gives a local-noon instant for a YYYY-MM-DD; round-trips to the same day.
  const iso = dueFromDay("2026-06-19")!;
  assert.equal(ymd(new Date(iso)), "2026-06-19");
  assert.equal(reflectionSectionKey(schedule, iso), "day:2026-06-19");
});
