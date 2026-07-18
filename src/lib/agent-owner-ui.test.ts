import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Usability guard: agent management exposes owner assignment from workspace
// members, so a user-owned agent inherits that user's board access (the
// enforcement itself is covered in board-members.test.ts).
const agentsPage = readFileSync("src/app/(app)/agents/page.tsx", "utf8");
const agentsView = readFileSync("src/components/agents/agents-view.tsx", "utf8");
const agentRoute = readFileSync("src/app/api/agents/[agentId]/route.ts", "utf8");
const agentsSvc = readFileSync("src/lib/services/agents.ts", "utf8");

test("Agents page loads workspace members and each agent's owner", () => {
  assert.match(agentsPage, /ownerUserId: a\.ownerUserId/);
  assert.match(agentsPage, /workspaceMember\.findMany/);
  assert.match(agentsPage, /members=\{members\}/);
});

test("Agent card exposes owner assignment (set and clear) via PATCH ownerUserId", () => {
  assert.match(agentsView, /patch\(\{ ownerUserId: m\.id \}, "owner"\)/);
  assert.match(agentsView, /patch\(\{ ownerUserId: null \}, "owner"\)/);
  assert.match(agentsView, /Workspace-wide \(no owner\)/);
});

test("Owner changes are manager-only and validated against the workspace", () => {
  assert.match(agentRoute, /assertManager\(ctx\)/);
  assert.match(agentsSvc, /Owner must be a member of this workspace/);
});
