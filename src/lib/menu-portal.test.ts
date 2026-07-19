import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Static guards for the shared Menu primitive: its dropdown must escape
 * overflow-hidden ancestors (e.g. the admin users card) via a portal with
 * fixed positioning, instead of the old in-flow absolute dropdown that got
 * clipped inside rounded list cards on mobile.
 */
const menu = readFileSync("src/components/ui/menu.tsx", "utf8");
const modal = readFileSync("src/components/ui/modal.tsx", "utf8");
const admin = readFileSync("src/components/admin/admin-dashboard.tsx", "utf8");

test("menu content renders through a body portal with fixed positioning", () => {
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /document\.body,?\s*\)/);
  assert.match(menu, /position: "fixed"/);
  // the old in-flow dropdown that overflow-hidden ancestors clipped
  assert.doesNotMatch(menu, /"absolute z-40/);
});

test("menu measures the trigger rect and can flip above it near the viewport bottom", () => {
  assert.match(menu, /getBoundingClientRect\(\)/);
  assert.match(menu, /window\.innerHeight/);
  assert.match(menu, /openUp/);
});

test("menu layers above the modal so ticket-modal menus stay on top", () => {
  const menuZ = menu.match(/z-\[(\d+)\]/);
  assert.ok(menuZ, "menu should declare an explicit z-index");
  const modalZ = modal.match(/\bz-(\d+)\b/);
  assert.ok(modalZ, "modal should declare a z-index");
  assert.ok(Number(menuZ[1]) > Number(modalZ[1]), "menu z-index must exceed the modal's");
});

test("menu closes on outside press, Escape, and scroll (fixed position would drift)", () => {
  assert.match(menu, /contentRef\.current\?\.contains/);
  assert.match(menu, /e\.key === "Escape"/);
  assert.match(menu, /"scroll", onScroll, true/);
});

test("admin users card keeps its rounded clipping — the menu escapes via the portal", () => {
  assert.match(admin, /overflow-hidden rounded-2xl border border-border bg-surface/);
});
