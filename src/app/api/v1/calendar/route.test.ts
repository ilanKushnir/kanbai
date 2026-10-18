import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { todayYmd, workspaceTz } from "@/lib/tz";
import { GET } from "./route";

// The agent's read-only view of the owner's calendar: days default to today in
// the workspace timezone, ranges are validated, and an owner without linked
// calendars is reported as not connected (no network involved).

const KEY = "kbai_live_calendar_key_000000000000000";

function req(query = "") {
  return new Request(`http://test.local/api/v1/calendar${query}`, { headers: { authorization: `Bearer ${KEY}` } });
}

async function wipe() {
  await db.activityLog.deleteMany();
  await db.agent.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const owner = await db.user.create({ data: { email: "owner@cal.test", name: "Owner" } });
  const ws = await db.workspace.create({
    data: { name: "Cal WS", slug: "cal-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "notes:read" } });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("defaults to today; not connected without calendar links", async () => {
  const res = await GET(req());
  assert.equal(res.status, 200);
  const body = await res.json();
  const today = todayYmd(workspaceTz());
  assert.deepEqual([body.connected, body.from, body.to, body.events], [false, today, today, []]);
  assert.equal(body.timezone, workspaceTz());
});

test("validates days and ranges", async () => {
  assert.equal((await GET(req("?day=2026-10-20"))).status, 200);
  assert.equal((await GET(req("?day=next week"))).status, 422);
  assert.equal((await GET(req("?from=2026-10-20&to=2026-10-01"))).status, 422);
  assert.equal((await GET(req("?from=2026-01-01&to=2026-03-01"))).status, 422);
});
