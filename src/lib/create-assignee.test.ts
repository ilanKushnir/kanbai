import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTicketSchema } from "@/lib/validation";

// Usability guard: a ticket can be assigned at creation time — the add-card
// composer offers board members (+ agents) and the create call carries the
// choice, so no open-the-modal-then-assign round trip is needed.
const boardView = readFileSync("src/components/board/board-view.tsx", "utf8");
const ticketsRoute = readFileSync("src/app/api/tickets/route.ts", "utf8");

test("AddCard offers an assignee picker fed by board members and agents", () => {
  assert.match(boardView, /function AddCard\(\{\s*onCreate,\s*members,\s*agents,\s*currentUser,/);
  assert.match(boardView, /assignableUsers\.map/); // board members (current user always included)
  assert.match(boardView, /setAssignee\(\{ type: "user", id: m\.id/);
  assert.match(boardView, /setAssignee\(\{ type: "agent", id: a\.id/);
});

test("handleCreate sends the chosen assignee with the create call", () => {
  assert.match(boardView, /handleCreate\(columnId: string, title: string, assignee\?: NewAssignee \| null\)/);
  assert.match(boardView, /assigneeType: assignee\.type/);
  assert.match(boardView, /assigneeUserId: assignee\.id/);
  assert.match(boardView, /assigneeAgentId: assignee\.id/);
  // The optimistic temp card shows the assignee immediately.
  assert.match(boardView, /assignee: assignee \?\? null/);
});

test("the create endpoint accepts an assignee at creation", () => {
  const parsed = createTicketSchema.safeParse({
    boardId: "brd_1",
    columnId: "col_1",
    title: "Pre-assigned",
    assigneeType: "user",
    assigneeUserId: "usr_1",
  });
  assert.equal(parsed.success, true);
  // The route hands the full input (assignee included) to the service.
  assert.match(ticketsRoute, /createTicket\(input/);
});
