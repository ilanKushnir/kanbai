import assert from "node:assert/strict";
import test from "node:test";
import { checklistProgressSchema } from "./checklist-progress";

test("parses a v1 progress file (items only, extra top-level keys ignored)", () => {
  const parsed = checklistProgressSchema.parse({
    kanbai: "progress",
    version: 1,
    exportedAt: "2026-07-16T10:00:00.000Z",
    items: [{ type: "ticket", id: "tk1", done: true, doneAt: "2026-07-16" }],
  });
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.extras, []);
});

test("parses a v2 progress file with extras", () => {
  const parsed = checklistProgressSchema.parse({
    version: 2,
    items: [{ type: "note", id: "n1", done: true }],
    extras: [
      { id: "xabc", text: "buy a UPS battery", done: true, doneAt: "2026-07-15", createdAt: "2026-07-14" },
      { text: "no id is fine" },
    ],
  });
  assert.equal(parsed.extras.length, 2);
  assert.equal(parsed.extras[0].done, true);
});

test("extras alone are enough (a file with only new offline tasks imports)", () => {
  const parsed = checklistProgressSchema.parse({ extras: [{ text: "משימה חדשה" }] });
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.extras.length, 1);
});

test("an empty file is rejected with a clear message", () => {
  const res = checklistProgressSchema.safeParse({ items: [], extras: [] });
  assert.equal(res.success, false);
});

test("bad day stamps and blank extra text are rejected", () => {
  assert.equal(
    checklistProgressSchema.safeParse({ items: [{ type: "note", id: "n1", doneAt: "16/07/2026" }] }).success,
    false,
  );
  assert.equal(checklistProgressSchema.safeParse({ extras: [{ text: "   " }] }).success, false);
});

test("unknown item types are rejected (only ticket|note ids can be ticked)", () => {
  assert.equal(
    checklistProgressSchema.safeParse({ items: [{ type: "board", id: "b1", done: true }] }).success,
    false,
  );
});
