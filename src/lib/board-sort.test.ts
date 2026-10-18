import { test } from "node:test";
import assert from "node:assert/strict";
import { columnSort, parseBoardSort, sortIds } from "./board-sort";

const t = (dueDate: string | null, priority: string, extra: Partial<{ createdAt: string; updatedAt: string; completedAt: string | null }> = {}) => ({
  dueDate,
  priority,
  createdAt: extra.createdAt ?? "2026-10-01T00:00:00Z",
  updatedAt: extra.updatedAt ?? "2026-10-01T00:00:00Z",
  completedAt: extra.completedAt ?? null,
});

test("due: soonest first, no due date last, ties by priority then manual order", () => {
  const byId = {
    a: t(null, "urgent"),
    b: t("2026-10-20T09:00:00Z", "low"),
    c: t("2026-10-19T09:00:00Z", "medium"),
    d: t("2026-10-20T09:00:00Z", "high"),
    e: t(null, "low"),
    f: t("2026-10-20T09:00:00Z", "high"),
    g: t("2026-10-20T15:00:00Z", "urgent"),
  };
  assert.deepEqual(sortIds(["a", "b", "c", "d", "e", "f", "g"], byId, "due"), ["c", "g", "d", "f", "b", "a", "e"]);
});

test("priority: highest first, then soonest due", () => {
  const byId = { a: t("2026-10-25T00:00:00Z", "high"), b: t("2026-10-21T00:00:00Z", "high"), c: t(null, "urgent"), d: t("2026-10-19T00:00:00Z", "none") };
  assert.deepEqual(sortIds(["a", "b", "c", "d"], byId, "priority"), ["c", "b", "a", "d"]);
});

test("completed and manual", () => {
  const byId = { a: t(null, "low", { completedAt: "2026-10-10T00:00:00Z" }), b: t(null, "low", { completedAt: "2026-10-12T00:00:00Z" }) };
  assert.deepEqual(sortIds(["a", "b"], byId, "completed"), ["b", "a"]);
  assert.deepEqual(sortIds(["a", "b"], byId, "manual"), ["a", "b"]);
});

test("column choice: own > board-wide > default (done columns keep completion order under Due)", () => {
  const todo = { id: "c1", isDone: false };
  const done = { id: "c2", isDone: true };
  assert.equal(columnSort({ cols: {} }, todo), "due");
  assert.equal(columnSort({ cols: {} }, done), "completed");
  assert.equal(columnSort({ all: "due", cols: {} }, done), "completed");
  assert.equal(columnSort({ all: "priority", cols: {} }, done), "priority");
  assert.equal(columnSort({ all: "priority", cols: { c1: "manual" } }, todo), "manual");
  assert.deepEqual(parseBoardSort('{"all":"bogus","cols":{"x":"due","y":"nope"}}'), { all: undefined, cols: { x: "due" } });
  assert.deepEqual(parseBoardSort("not json"), { cols: {} });
});
