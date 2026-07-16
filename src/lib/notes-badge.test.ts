import { test } from "node:test";
import assert from "node:assert/strict";

import { countNotesAttention, type BadgeNote, type BadgeReflection } from "@/lib/notes-badge";

const today = "2026-06-21";
const todayNoon = new Date(2026, 5, 21, 12, 0, 0);

const note = (over: Partial<BadgeNote>): BadgeNote => ({
  status: "inbox",
  scheduledDay: today,
  bucket: "today",
  doneOn: null,
  ...over,
});

const reflection = (over: Partial<BadgeReflection>): BadgeReflection => ({
  dueDate: new Date(2026, 5, 21, 12, 0, 0).toISOString(),
  done: false,
  ...over,
});

test("Notes badge counts today + overdue notes and reflected tickets together", () => {
  const count = countNotesAttention({
    now: todayNoon,
    notes: [
      note({}), // scheduled today
      note({ scheduledDay: "2026-06-19" }), // overdue → classifies into Today
      note({ status: "queued" }), // queued notes still occupy the Today section
    ],
    reflections: [
      reflection({}), // due today
      reflection({ dueDate: new Date(2026, 5, 18, 12, 0, 0).toISOString() }), // overdue
    ],
  });
  assert.equal(count, 5);
});

test("Notes badge excludes unscheduled, future, done, and archived notes", () => {
  const count = countNotesAttention({
    now: todayNoon,
    notes: [
      note({ scheduledDay: null, bucket: "general" }), // Unsorted
      note({ scheduledDay: "2026-06-22", bucket: "tomorrow" }), // future
      note({ doneOn: today }), // done today — lingers in the section but needs no attention
      note({ doneOn: "2026-06-20" }), // done earlier — swept out entirely
      note({ status: "archived" }),
      note({ status: "sorted" }),
    ],
    reflections: [],
  });
  assert.equal(count, 0);
});

test("Notes badge follows coarse-bucket rollover: an expired Next Week note is Unsorted, not Today", () => {
  const count = countNotesAttention({
    now: todayNoon,
    notes: [
      note({ scheduledDay: "2026-06-20", bucket: "next_week" }), // rolled back to Unsorted
      note({ scheduledDay: "2026-06-20", bucket: "next_month" }),
      note({ scheduledDay: "2026-06-20", bucket: "today" }), // genuinely overdue → counts
    ],
    reflections: [],
  });
  assert.equal(count, 1);
});

test("Notes badge excludes done and future ticket reflections", () => {
  const count = countNotesAttention({
    now: todayNoon,
    notes: [],
    reflections: [
      reflection({ done: true }), // completed ticket still reflected on its due day
      reflection({ dueDate: new Date(2026, 5, 25, 12, 0, 0).toISOString() }), // later this week
      reflection({}), // due today → counts
    ],
  });
  assert.equal(count, 1);
});
