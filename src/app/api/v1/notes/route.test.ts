import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as GET_ONE, PATCH, DELETE } from "./[noteId]/route";

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) assert.fail(`expected ${status}, got ${res.status}: ${await res.text()}`);
}

// v1 notes: soft-deleted notes are invisible to list/get/patch (they live in
// /trash), note mutations log activity with the agent as actor, and marking a
// note done logs note.done.

const KEY = "kbai_live_notes_key_000000000000000000";

let liveId: string;
let deletedId: string;

function req(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`http://test.local/api/v1/notes${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ctx = (noteId: string) => ({ params: Promise.resolve({ noteId }) });

async function wipe() {
  await db.activityLog.deleteMany();
  await db.note.deleteMany();
  await db.agent.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const owner = await db.user.create({ data: { email: "owner@notes.test", name: "Ilan" } });
  const ws = await db.workspace.create({
    data: { name: "Notes WS", slug: "notes-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "notes:read,notes:write" } });
  liveId = (await db.note.create({ data: { userId: owner.id, body: "Alive" } })).id;
  deletedId = (await db.note.create({ data: { userId: owner.id, body: "Gone", deletedAt: new Date() } })).id;
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("list excludes soft-deleted notes", async () => {
  const res = await LIST(req(""));
  assert.equal(res.status, 200);
  const { notes } = await res.json();
  assert.deepEqual(notes.map((n: { body: string }) => n.body), ["Alive"]);
});

test("get / patch / delete 404 on a soft-deleted note", async () => {
  assert.equal((await GET_ONE(req(`/${deletedId}`), ctx(deletedId))).status, 404);
  assert.equal((await PATCH(req(`/${deletedId}`, { pinned: true }, "PATCH"), ctx(deletedId))).status, 404);
  assert.equal((await DELETE(req(`/${deletedId}`, undefined, "DELETE"), ctx(deletedId))).status, 404);
  assert.equal((await GET_ONE(req(`/${liveId}`), ctx(liveId))).status, 200);
});

test("create / done / delete log activity under the agent's name", async () => {
  const created = await CREATE(req("", { body: "Buy milk", scheduledDay: "2026-10-14" }));
  await expectStatus(created, 201);
  const { note } = await created.json();
  assert.equal(note.scheduledDay, "2026-10-14");

  const done = await PATCH(req(`/${note.id}`, { doneOn: "2026-10-14" }, "PATCH"), ctx(note.id));
  assert.equal(done.status, 200);
  assert.equal((await done.json()).note.doneOn, "2026-10-14");

  const gone = await DELETE(req(`/${note.id}`, undefined, "DELETE"), ctx(note.id));
  assert.equal(gone.status, 200);
  assert.equal((await LIST(req(""))).status, 200);
  const { notes } = await (await LIST(req(""))).json();
  assert.equal(notes.some((n: { id: string }) => n.id === note.id), false);

  const rows = await db.activityLog.findMany({ where: { meta: { contains: note.id } }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((r) => r.action), ["note.created", "note.done", "note.deleted"]);
  assert.ok(rows.every((r) => r.actorType === "agent" && r.actorName === "Astra"));
});
