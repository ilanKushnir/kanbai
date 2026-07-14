import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guards for the agent API's management powers: close tickets, soft-delete
// into the 30-day trash, list + restore from it — with proper scoping.
const ticketRoute = readFileSync("src/app/api/v1/tickets/[ticketId]/route.ts", "utf8");
const doneRoute = readFileSync("src/app/api/v1/tickets/[ticketId]/done/route.ts", "utf8");
const trashRoute = readFileSync("src/app/api/v1/trash/route.ts", "utf8");
const trashSvc = readFileSync("src/lib/services/trash.ts", "utf8");
const constants = readFileSync("src/lib/constants.ts", "utf8");
const docs = readFileSync("docs/AGENT_PROTOCOL.md", "utf8");

test("Agents can soft-delete tickets (scoped, workspace-checked, restorable)", () => {
  assert.match(ticketRoute, /export const DELETE = handler/);
  assert.match(ticketRoute, /requireScope\(agent, "tickets:write"\)/);
  assert.match(ticketRoute, /assertTicketInWorkspace\(ticketId, agent\.workspaceId\)/);
  assert.match(ticketRoute, /deleteTicket\(ticketId/); // soft-delete service (deletedAt), not a hard delete
});

test("Agents can close a ticket in one call via /done", () => {
  assert.match(doneRoute, /requireScope\(agent, "tickets:write"\)/);
  assert.match(doneRoute, /moveTicketToDone\(ticketId/);
});

test("Trash endpoint scopes listing per resource and gates restores on write scopes", () => {
  assert.match(trashRoute, /scopes\.includes\("notes:read"\)/);
  assert.match(trashRoute, /scopes\.includes\("tickets:read"\)/);
  assert.match(trashRoute, /requireScope\(agent, "notes:write"\)/);
  assert.match(trashRoute, /requireScope\(agent, "tickets:write"\)/);
  // Restore only — permanent purge must never be reachable by agents.
  assert.doesNotMatch(trashRoute, /purgeNote|purgeTicket/);
});

test("Workspace-scoped trash service checks membership/board ownership and trash state", () => {
  assert.match(trashSvc, /export async function listTrashForWorkspace/);
  assert.match(trashSvc, /export async function restoreNoteInWorkspace/);
  assert.match(trashSvc, /export async function restoreTicketInWorkspace/);
  // Notes: owner must be a member of the agent's workspace.
  assert.match(trashSvc, /workspaceMember\.findFirst\(\{ where: \{ workspaceId, userId: n\.userId \}/);
  // Tickets: the board must belong to the agent's workspace.
  assert.match(trashSvc, /t\.board\.workspaceId !== workspaceId/);
  // Restoring something that isn't deleted is a clear 422, not a silent no-op.
  assert.match(trashSvc, /not_deleted/);
});

test("New powers are advertised via /v1/me capabilities and documented", () => {
  assert.match(constants, /"trash"/);
  assert.match(constants, /softDelete: true/);
  assert.match(constants, /trashRestore: true/);
  assert.match(docs, /POST {3}\/tickets\/\{id\}\/done/);
  assert.match(docs, /DELETE \/tickets\/\{id\}/);
  assert.match(docs, /### Trash \(30-day restore\)/);
  assert.match(docs, /"doneOn":"2026-07-14"/); // notes done-marking is documented
});
