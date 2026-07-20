import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// UX guards for the agent webhook setup flow — the affordances that prevent
// the classic silent-secret-mismatch 401 from coming back.
const agentsView = readFileSync("src/components/agents/agents-view.tsx", "utf8");
const testRoute = readFileSync("src/app/api/agents/[agentId]/test/route.ts", "utf8");
const v1TestRoute = readFileSync("src/app/api/v1/agent/webhook/test/route.ts", "utf8");
const docs = readFileSync("docs/AGENT_PROTOCOL.md", "utf8");

test("Send test waits for the delivery and shows the receiver's real verdict inline", () => {
  assert.match(agentsView, /api<TestSendResultT>\(`\/api\/agents\/\$\{agent\.id\}\/test`/);
  assert.match(agentsView, /function TestResultPanel/);
  assert.match(agentsView, /result\.statusCode === 401 \|\| result\.statusCode === 403/);
  // 401 troubleshooting names the exact failure mode and the fingerprint
  assert.match(agentsView, /secretFingerprint/);
  assert.match(agentsView, /verifying with a/);
});

test("pasting a secret has an explicit Save button (not an Enter-only trap)", () => {
  assert.match(agentsView, /saveSecretDraft/);
  assert.match(agentsView, /onClick=\{saveSecretDraft\}/);
  // weak secrets are rejected client-side with a friendly message
  assert.match(agentsView, /v\.length < 8/);
});

test("event subscriptions are editable per agent and ping stays always-on", () => {
  assert.match(agentsView, /SELECTABLE_EVENTS\.map/);
  assert.match(agentsView, /toggleEvent\(ev\)/);
  assert.match(agentsView, /is always on/);
});

test("the agent brief warns about the pre-generated secret and documents fingerprints", () => {
  assert.match(agentsView, /ALREADY has an auto-generated signing secret/);
  assert.match(agentsView, /secretFingerprint = first 8 hex chars of sha256\(secret\)/);
});

test("both test endpoints return the awaited delivery outcome + fingerprint", () => {
  assert.match(testRoute, /sendTestWebhook\(agentId\)/);
  assert.match(v1TestRoute, /const \{ result, secretFingerprint \} = await sendTestWebhook\(agent\.id\)/);
});

test("the protocol docs explain the 401 secret-mismatch failure mode", () => {
  assert.match(docs, /sync the secret or you'll see 401s/);
  assert.match(docs, /auto-generated signing secret/);
  assert.match(docs, /secretFingerprint/);
});
