import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These guard the section-based drag/drop model on the board: empty columns AND
// empty sub-state bands must be drop targets, drops must persist consistently,
// and a cancelled/void drag must not strand an optimistic move.
const boardView = readFileSync("src/components/board/board-view.tsx", "utf8");
const tickets = readFileSync("src/lib/services/tickets.ts", "utf8");
const columnRoute = readFileSync("src/app/api/columns/[columnId]/route.ts", "utf8");

test("Board uses a pointer-first collision strategy so empty columns/bands are droppable", () => {
  // pointerWithin → rectIntersection, with a closestCenter fallback for dead space.
  assert.match(boardView, /pointerWithin\(args\)/);
  assert.match(boardView, /rectIntersection\(args\)/);
  assert.match(boardView, /getFirstCollision\(closestCenter\(args\), "id"\)/);
  // The old corner-based strategy (which strands empty columns) must be gone.
  assert.doesNotMatch(boardView, /closestCorners/);
});

test("Each sub-state is its own droppable band (section-keyed containers)", () => {
  assert.match(boardView, /function sectionKey\(/);
  assert.match(boardView, /function columnSectionKeys\(/);
  // Bands and the plain column body are both rendered as a droppable <Section>.
  assert.match(boardView, /useDroppable\(\{ id \}\)/);
});

test("A cancelled or void drag reverts the optimistic move (no stranded card)", () => {
  assert.match(boardView, /dragSnapshot\.current = containersRef\.current/);
  assert.match(boardView, /function onDragCancel\(\)/);
  assert.match(boardView, /onDragCancel=\{onDragCancel\}/);
  // onDragEnd restores the snapshot when released onto nothing.
  assert.match(boardView, /if \(!over\) \{\s*\n\s*\/\/[^\n]*\n\s*setCont\(dragSnapshot\.current\);/);
});

test("Server keeps a column grouped by sub-state band so column-wide positions stay valid", () => {
  // moveTicket must order the destination column by band before inserting, so the
  // client's grouped position index matches the server's stored order.
  assert.match(tickets, /const bandIndex = \(sub: string \| null\)/);
  assert.match(tickets, /\.sort\(\(a, b\) => a\.band - b\.band \|\| a\.ord - b\.ord\)/);
});

test("Editing a column's sub-states reconciles each ticket's stored sub-state", () => {
  assert.match(tickets, /export async function reconcileColumnSubStates\(/);
  // The internal column PATCH must invoke it when the band list changes.
  assert.match(columnRoute, /reconcileColumnSubStates\(columnId\)/);
  assert.match(columnRoute, /if \(input\.subStates !== undefined\)/);
});
