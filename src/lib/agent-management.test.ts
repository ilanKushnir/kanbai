import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guards for the expanded agent management surface: one-action note→ticket
// promotion, board update/archive, full column management, member management —
// all recoverable-by-design (agents can never hard-delete data).
const promoteRoute = readFileSync("src/app/api/v1/notes/[noteId]/promote/route.ts", "utf8");
const boardRoute = readFileSync("src/app/api/v1/boards/[boardId]/route.ts", "utf8");
const columnsRoute = readFileSync("src/app/api/v1/boards/[boardId]/columns/route.ts", "utf8");
const columnRoute = readFileSync("src/app/api/v1/boards/[boardId]/columns/[columnId]/route.ts", "utf8");
const reorderRoute = readFileSync("src/app/api/v1/boards/[boardId]/columns/reorder/route.ts", "utf8");
const membersRoute = readFileSync("src/app/api/v1/members/[userId]/route.ts", "utf8");
const notesSvc = readFileSync("src/lib/services/notes.ts", "utf8");
const constants = readFileSync("src/lib/constants.ts", "utf8");
const meRoute = readFileSync("src/app/api/v1/me/route.ts", "utf8");
const docs = readFileSync("docs/AGENT_PROTOCOL.md", "utf8");

test("Note → ticket promotion is one action, dual-scoped, and never deletes the note", () => {
  assert.match(promoteRoute, /requireScope\(agent, "notes:write"\)/);
  assert.match(promoteRoute, /requireScope\(agent, "tickets:write"\)/);
  assert.match(promoteRoute, /getWorkspaceNote\(noteId, agent\.workspaceId\)/); // any workspace note, not just this agent's inbox
  assert.match(promoteRoute, /guardAgentSnapshot/); // undoable via snapshot restore
  assert.match(promoteRoute, /fulfillNote\(/); // shared service: create ticket + mark sorted
  assert.match(promoteRoute, /409, "Note already sorted/);
  // The note is marked sorted (recoverable), NEVER soft- or hard-deleted.
  assert.doesNotMatch(promoteRoute, /deleteNote|deletedAt: new Date|note\.delete\(/);
});

test("fulfillNote links the ticket and marks the note sorted atomically", () => {
  assert.match(notesSvc, /db\.\$transaction\(\[\s*db\.ticket\.update\(\{ where: \{ id: ticket\.id \}, data: \{ sourceNoteId: noteId \} \}\),\s*db\.note\.update\(\{ where: \{ id: noteId \}, data: \{ status: "sorted" \} \}\),\s*\]\)/);
});

test("Agents archive boards instead of deleting them (reversible, no DELETE export)", () => {
  assert.match(boardRoute, /export const PATCH = handler/);
  assert.match(boardRoute, /requireScope\(agent, "boards:write"\)/);
  assert.match(boardRoute, /archived/);
  assert.match(boardRoute, /guardAgentSnapshot/);
  assert.doesNotMatch(boardRoute, /export const DELETE/);
  assert.doesNotMatch(boardRoute, /board\.delete/);
});

test("Agents manage columns: create, reorder, and delete only when empty", () => {
  assert.match(columnsRoute, /export const POST = handler/);
  assert.match(columnsRoute, /requireScope\(agent, "boards:write"\)/);
  assert.match(reorderRoute, /orderedIds must contain every column of this board exactly once/);
  // Delete counts trashed tickets too — the FK cascade would destroy items
  // promised a 30-day restore, so a non-empty column is a 422, not a wipe.
  assert.match(columnRoute, /export const DELETE = handler/);
  assert.match(columnRoute, /db\.ticket\.count\(\{ where: \{ columnId \} \}\)/);
  assert.match(columnRoute, /column_not_empty/);
  assert.match(columnRoute, /last_column/);
});

test("Column stage is settable via the agent API and kept in lockstep with isDone", () => {
  const boardsSvc = readFileSync("src/lib/services/boards.ts", "utf8");
  const validation = readFileSync("src/lib/validation.ts", "utf8");
  assert.match(validation, /stage: z\.enum\(COLUMN_STAGES\)\.optional\(\)/);
  assert.match(boardsSvc, /export function applyColumnStageSync/);
  assert.match(boardsSvc, /data\.isDone = input\.stage === "done"/);
  assert.match(boardsSvc, /resolveColumnStage/); // serialized on every read-back
});

test("Agents manage members but can never touch the owner or destroy accounts", () => {
  assert.match(membersRoute, /requireScope\(agent, "members:write"\)/);
  assert.match(membersRoute, /The workspace owner can't be changed\./);
  assert.match(membersRoute, /The workspace owner can't be removed\./);
  assert.match(membersRoute, /workspaceMember\.delete/); // membership row only
  assert.doesNotMatch(membersRoute, /db\.user\.delete/);
});

test("New powers are advertised via /v1/me capabilities and documented", () => {
  assert.match(constants, /notePromote: true/);
  assert.match(constants, /boardArchive: true/);
  assert.match(constants, /columnStages: true/);
  assert.match(constants, /"columns"/);
  assert.match(meRoute, /columnStages: COLUMN_STAGES\.map/);
  assert.match(docs, /POST {3}\/notes\/\{noteId\}\/promote/);
  assert.match(docs, /PATCH {2}\/boards\/\{boardId\}/);
  assert.match(docs, /DELETE \/boards\/\{boardId\}\/columns\/\{columnId\}/);
  assert.match(docs, /DELETE \/members\/\{userId\}/);
  assert.match(docs, /Never emulate this with create-ticket \+ delete-note/);
});
