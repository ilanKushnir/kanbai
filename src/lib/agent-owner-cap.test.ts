import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// An agent bound to a non-manager owner must not exceed that owner's authority:
// no member management, and notes limited to the owner's own — closing the
// privilege-escalation gap where an owned agent could promote its owner or read
// every member's private notes.
const access = readFileSync("src/lib/access.ts", "utf8");
const notesSvc = readFileSync("src/lib/services/notes.ts", "utf8");
const membersList = readFileSync("src/app/api/v1/members/route.ts", "utf8");
const membersItem = readFileSync("src/app/api/v1/members/[userId]/route.ts", "utf8");
const notesList = readFileSync("src/app/api/v1/notes/route.ts", "utf8");
const noteItem = readFileSync("src/app/api/v1/notes/[noteId]/route.ts", "utf8");

test("access.ts derives manager authority and a note scope from the agent's owner", () => {
  assert.match(access, /export async function agentHasManagerAuthority/);
  assert.match(access, /export async function agentNoteScope/);
  // No owner → full authority; owner must be owner/admin for manager authority.
  assert.match(access, /if \(!agent\.ownerUserId\) return true;/);
  assert.match(access, /role === "owner" \|\| m\?\.role === "admin"/);
});

test("member management is gated on manager authority (both routes, all verbs)", () => {
  // List + add
  assert.match(membersList, /agentHasManagerAuthority/);
  assert.equal((membersList.match(/assertMemberAuthority\(agent\)/g) || []).length, 2); // GET + POST
  // Update role + remove
  assert.match(membersItem, /agentHasManagerAuthority/);
  assert.equal((membersItem.match(/assertMemberAuthority\(agent\)/g) || []).length, 2); // PATCH + DELETE
});

test("notes list/create confine an owned agent to its owner", () => {
  assert.match(notesList, /const scope = await agentNoteScope\(agent\)/);
  // Listing: scope wins over any userId query param.
  assert.match(notesList, /const userId = scope \?\? url\.searchParams\.get\("userId"\)/);
  // Creating: scope forces the owner, bypassing user-supplied targeting.
  assert.match(notesList, /const userId = scope \?\? \(await resolveWorkspaceUserId/);
});

test("single-note access re-checks the owner scope (404, no id leak)", () => {
  // Every getWorkspaceNote call in the per-note route passes the agent's scope.
  assert.equal(
    (noteItem.match(/getWorkspaceNote\(noteId, agent\.workspaceId, await agentNoteScope\(agent\)\)/g) || []).length,
    3, // GET, PATCH, DELETE
  );
  // The service enforces it as a 404 identical to a missing note.
  assert.match(notesSvc, /restrictToUserId != null && note\.userId !== restrictToUserId/);
});
