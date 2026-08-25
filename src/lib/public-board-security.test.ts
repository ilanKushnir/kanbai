import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Locks in the public-board security posture: publishing is manager-only and
// session-only, agents can't publish, unshare retires the link, and the public
// payload is a strict allowlist that never leaks private fields.
const boardsSvc = readFileSync("src/lib/services/boards.ts", "utf8");
const publishRoute = readFileSync("src/app/api/boards/[boardId]/route.ts", "utf8");
const validation = readFileSync("src/lib/validation.ts", "utf8");
const serialize = readFileSync("src/lib/serialize.ts", "utf8");
const authz = readFileSync("src/lib/authz.ts", "utf8");

test("Publishing a board is manager-only and session-authenticated", () => {
  assert.match(publishRoute, /getCurrentContext\(\)/);
  assert.match(publishRoute, /assertManager\(ctx\)/);
  assert.match(publishRoute, /assertBoardAccess\(ctx, boardId\)/);
});

test("Agent API cannot publish a board (no isPublic/publicId field)", () => {
  const schema = validation.slice(
    validation.indexOf("updateBoardV1Schema"),
    validation.indexOf("updateBoardV1Schema") + 400,
  );
  assert.doesNotMatch(schema, /isPublic|publicId/);
});

test("Unsharing retires the public token so a leaked link can't be reactivated", () => {
  const fn = boardsSvc.slice(
    boardsSvc.indexOf("export async function setBoardPublic"),
    boardsSvc.indexOf("export async function getPublicBoard"),
  );
  // Fresh token only when first sharing…
  assert.match(fn, /isPublic && !board\.publicId/);
  // …and cleared on unshare.
  assert.match(fn, /else if \(!isPublic\)/);
  assert.match(fn, /data\.publicId = null/);
});

test("Public board query is a single findUnique by token — no cross-board pivot", () => {
  const fn = boardsSvc.slice(
    boardsSvc.indexOf("export async function getPublicBoard"),
    boardsSvc.indexOf("export type PublicBoardData"),
  );
  assert.match(fn, /findUnique\(\{\s*where: \{ publicId \}/);
  // Retired/archived boards are dead links.
  assert.match(fn, /!board\.isPublic \|\| board\.archived/);
});

test("Public ticket serializer withholds private fields (allowlist, not omit-list)", () => {
  const fn = serialize.slice(
    serialize.indexOf("export function serializePublicTicket"),
    serialize.indexOf("export type SerializedPublicTicket"),
  );
  // These must never reach an anonymous viewer:
  assert.doesNotMatch(fn, /\bemail\b/);
  assert.doesNotMatch(fn, /avatarUrl/);
  assert.doesNotMatch(fn, /createdBy/);
  assert.doesNotMatch(fn, /sourceNoteId/);
  assert.doesNotMatch(fn, /comments:\s*t\.comments\.map/); // comment BODIES never exposed
  assert.doesNotMatch(fn, /assigneeUserId:/); // no raw user ids
});

test("Board access is workspace-scoped and write requires an edit grant", () => {
  // Non-managers only see boards they were explicitly granted.
  assert.match(authz, /access: \{ some: \{ userId: ctx\.user\.id \} \}/);
  // Cross-workspace board ids 404 rather than leak.
  assert.match(authz, /board\.workspaceId !== ctx\.workspace\.id[\s\S]*throw new HttpError\(404/);
  // View-only grants can't write.
  assert.match(authz, /write && grant\.level !== "edit"/);
  // Ticket/column access re-resolve the parent board (no direct-object bypass).
  assert.match(authz, /assertBoardAccess\(ctx, ticket\.boardId, write\)/);
  assert.match(authz, /assertBoardAccess\(ctx, col\.boardId, write\)/);
});
