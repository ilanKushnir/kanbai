import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cardAssignees } from "@/lib/display";

// Rendering guard: Week View cards show every assignee (multi-assign) as a
// compact overlapping stack with a "+N" chip past the cap — not just the
// legacy primary — while unassigned and single-assignee cards stay unchanged.
// (Server-side multi-assign persistence is covered in ticket-multi-assignee.test.ts.)

type A = { type: "user" | "agent"; id: string; name: string };
const a = (id: string): A => ({ type: "user", id, name: `User ${id}` });

test("cardAssignees prefers the full multi-assign list", () => {
  const list = [a("u1"), a("u2"), a("u3")];
  assert.deepEqual(cardAssignees({ assignee: list[0], assignees: list }), list);
});

test("cardAssignees falls back to the legacy single assignee", () => {
  const only = a("u1");
  assert.deepEqual(cardAssignees({ assignee: only, assignees: [] }), [only]);
  assert.deepEqual(cardAssignees({ assignee: only }), [only]);
});

test("cardAssignees is empty for unassigned tickets", () => {
  assert.deepEqual(cardAssignees({ assignee: null, assignees: [] }), []);
  assert.deepEqual(cardAssignees({ assignee: null }), []);
});

const weekView = readFileSync("src/components/board/week-view.tsx", "utf8");

test("WeekCard renders the full assignee stack, capped with a +N overflow chip", () => {
  assert.match(weekView, /const assignees = cardAssignees\(ticket\)/);
  assert.match(weekView, /assignees\.slice\(0, WEEK_CARD_AVATAR_LIMIT\)/);
  assert.match(weekView, /\+\{assignees\.length - WEEK_CARD_AVATAR_LIMIT\}/);
  // The stack overlaps with logical-property spacing (RTL safe) and hangs at
  // the line end without squeezing the row (`ms-auto`, `shrink-0`).
  assert.match(weekView, /ms-auto flex shrink-0 items-center -space-x-1/);
});

test("WeekCard stack and overflow carry accessible labels/tooltips", () => {
  // The group names every assignee for AT; each face keeps its own tooltip.
  assert.match(weekView, /aria-label=\{`Assigned to \$\{assignees\.map\(\(a\) => assigneeLabel\(a\)\)\.join\(", "\)\}`\}/);
  assert.match(weekView, /title=\{assigneeLabel\(a\)\}/);
  // The "+N" chip's tooltip lists exactly the folded-away assignees.
  assert.match(weekView, /title=\{assignees\.slice\(WEEK_CARD_AVATAR_LIMIT\)\.map\(\(a\) => assigneeLabel\(a\)\)\.join\(", "\)\}/);
});
