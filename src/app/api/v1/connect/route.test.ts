import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { issueConnectCode, rotateApiKey, CONNECT_RETRY_GRACE_MS, CONNECT_CODE_TTL_MS } from "@/lib/services/agents";
import { POST } from "./route";
import { GET as SKILL } from "../skill.md/route";

// The connect brief carries a one-time code; POST /api/v1/connect trades it
// for a fresh API key. The old key keeps working until the code is redeemed.

const OLD_KEY = "kbai_live_connect_old_00000000000000000";
let agentId: string;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.agent.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

function redeem(body: unknown) {
  return POST(
    new Request("http://kanbai.test/api/v1/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

before(async () => {
  await wipe();
  const owner = await db.user.create({ data: { email: "owner@connect.test", name: "Owner" } });
  const ws = await db.workspace.create({
    data: { name: "WS", slug: "connect-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  const agent = await db.agent.create({ data: { workspaceId: ws.id, name: "Agent", apiKeyHash: hashApiKey(OLD_KEY) } });
  agentId = agent.id;
});

after(wipe);

test("issuing a code keeps the current key; redeeming mints a new one", async () => {
  const { code } = await issueConnectCode(agentId);
  assert.ok(code.startsWith("kbc_"));
  assert.ok(await db.agent.findUnique({ where: { apiKeyHash: hashApiKey(OLD_KEY) } }), "old key still valid");

  const res = await redeem({ code });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.apiKey, /^kbai_live_/);
  assert.equal(json.agent.id, agentId);
  assert.match(json.baseUrl, /\/api\/v1$/);
  assert.match(json.skillUrl, /\/api\/v1\/skill\.md$/);

  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  assert.equal(agent.apiKeyHash, hashApiKey(json.apiKey));
  assert.ok(agent.lastSeenAt, "redeeming counts as checking in");
  assert.equal(await db.agent.findUnique({ where: { apiKeyHash: hashApiKey(OLD_KEY) } }), null, "old key revoked");
});

test("a retry inside the grace window works, after it the code is spent", async () => {
  const now = new Date();
  const { code } = await issueConnectCode(agentId, now);
  assert.equal((await redeem({ code })).status, 200);
  assert.equal((await redeem({ code })).status, 200, "immediate retry ok");

  await db.agent.update({
    where: { id: agentId },
    data: { connectRedeemedAt: new Date(Date.now() - CONNECT_RETRY_GRACE_MS - 1000) },
  });
  const res = await redeem({ code });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "code_expired");
});

test("expired, unknown, missing and rotated-away codes are rejected", async () => {
  const { code } = await issueConnectCode(agentId, new Date(Date.now() - CONNECT_CODE_TTL_MS - 1000));
  assert.equal((await (await redeem({ code })).json()).error.code, "code_expired");

  assert.equal((await (await redeem({ code: "kbc_nope" })).json()).error.code, "invalid_code");
  assert.equal((await redeem({})).status, 400);

  const fresh = await issueConnectCode(agentId);
  await rotateApiKey(agentId); // a manual rotation voids outstanding codes
  assert.equal((await (await redeem({ code: fresh.code })).json()).error.code, "invalid_code");
});

test("a disabled agent cannot connect", async () => {
  const { code } = await issueConnectCode(agentId);
  await db.agent.update({ where: { id: agentId }, data: { status: "disabled" } });
  assert.equal((await redeem({ code })).status, 403);
  await db.agent.update({ where: { id: agentId }, data: { status: "active" } });
});

test("GET /api/v1/skill.md serves a SKILL.md with frontmatter and the protocol", async () => {
  const res = await SKILL(new Request("http://kanbai.test/api/v1/skill.md"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  const md = await res.text();
  assert.match(md, /^---\nname: kanbai\n/);
  assert.match(md, /## 2\. `\/today`/);
  assert.match(md, /KANBAI_API_KEY/);
});
