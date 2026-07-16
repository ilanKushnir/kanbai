import { test } from "node:test";
import assert from "node:assert/strict";

import { containerOf, moveAcrossContainers, sectionDisplay } from "@/lib/notes-drag";

// ── sectionDisplay ────────────────────────────────────────────────────────────

const base = {
  key: "next_week",
  dragging: false,
  dragOriginKey: null as string | null,
  collapsedKeys: new Set<string>(),
  searching: false,
  count: 0,
};

test("sectionDisplay honors the collapsed set when idle", () => {
  assert.deepEqual(sectionDisplay({ ...base, collapsedKeys: new Set(["next_week"]) }), {
    open: false,
    mode: "rows",
  });
  assert.deepEqual(sectionDisplay(base), { open: true, mode: "rows" });
});

test("sectionDisplay opens only matching sections while searching", () => {
  assert.deepEqual(sectionDisplay({ ...base, searching: true, count: 0 }), { open: false, mode: "rows" });
  assert.deepEqual(
    sectionDisplay({ ...base, searching: true, count: 2, collapsedKeys: new Set(["next_week"]) }),
    { open: true, mode: "rows" },
  );
});

test("sectionDisplay collapses every non-origin section into a drop zone mid-drag", () => {
  const dragging = { ...base, dragging: true, dragOriginKey: "today" };
  assert.deepEqual(sectionDisplay({ ...dragging, key: "next_week" }), { open: true, mode: "drop-zone" });
  assert.deepEqual(sectionDisplay({ ...dragging, key: "day:2026-07-17" }), { open: true, mode: "drop-zone" });
  // the origin keeps its rows so in-section reordering still has context
  assert.deepEqual(sectionDisplay({ ...dragging, key: "today" }), { open: true, mode: "rows" });
});

test("sectionDisplay ignores the collapsed set mid-drag so every band is a landing zone", () => {
  const collapsed = new Set(["next_week", "this_week"]);
  const d = sectionDisplay({
    ...base,
    dragging: true,
    dragOriginKey: "general",
    collapsedKeys: collapsed,
  });
  assert.deepEqual(d, { open: true, mode: "drop-zone" });
});

// ── containerOf ───────────────────────────────────────────────────────────────

const map = () => ({
  general: ["a", "b"],
  today: ["c"],
  next_week: [] as string[],
});

test("containerOf resolves a container key to itself", () => {
  assert.equal(containerOf(map(), "next_week"), "next_week");
});

test("containerOf finds the container holding a row id", () => {
  assert.equal(containerOf(map(), "b"), "general");
  assert.equal(containerOf(map(), "c"), "today");
});

test("containerOf returns null for unknown ids", () => {
  assert.equal(containerOf(map(), "nope"), null);
});

// ── moveAcrossContainers ──────────────────────────────────────────────────────

test("moveAcrossContainers appends when hovering a container key (collapsed band drop)", () => {
  const next = moveAcrossContainers(map(), "a", "today");
  assert.deepEqual(next, { general: ["b"], today: ["c", "a"], next_week: [] });
});

test("moveAcrossContainers appends into an empty section", () => {
  const next = moveAcrossContainers(map(), "c", "next_week");
  assert.deepEqual(next, { general: ["a", "b"], today: [], next_week: ["c"] });
});

test("moveAcrossContainers inserts before a hovered row", () => {
  const next = moveAcrossContainers(map(), "c", "b");
  assert.deepEqual(next, { general: ["a", "c", "b"], today: [], next_week: [] });
});

test("moveAcrossContainers is a no-op within the same container", () => {
  assert.equal(moveAcrossContainers(map(), "a", "b"), null);
  assert.equal(moveAcrossContainers(map(), "a", "general"), null);
});

test("moveAcrossContainers returns null for unknown ids and never mutates its input", () => {
  const m = map();
  assert.equal(moveAcrossContainers(m, "ghost", "today"), null);
  assert.equal(moveAcrossContainers(m, "a", "ghost"), null);
  const before = JSON.stringify(m);
  moveAcrossContainers(m, "a", "today");
  assert.equal(JSON.stringify(m), before);
});
