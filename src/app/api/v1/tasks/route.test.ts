import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { notesToday } from "@/lib/services/notes";
import { addDaysYmd } from "@/lib/tz";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as GET_ONE, PATCH, DELETE } from "./[taskId]/route";
import { POST as DONE } from "./[taskId]/done/route";

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) assert.fail(`expected ${status}, got ${res.status}: ${await res.text()}`);
}

// v1 simple tasks: plain Today to-dos (notes underneath) — default to today,
// accept day words, complete/reopen, and never touch boards.

const KEY = "kbai_live_tasks_key_000000000000000000";
let ownerId: string;

function req(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`http://test.local/api/v1/tasks${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ctx = (taskId: string) => ({ params: Promise.resolve({ taskId }) });

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
  const owner = await db.user.create({ data: { email: "owner@tasks.test", name: "Owner" } });
  ownerId = owner.id;
  const ws = await db.workspace.create({
    data: { name: "Tasks WS", slug: "tasks-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "notes:read,notes:write" } });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("POST /tasks defaults to today, for the workspace owner, logged as the agent", async () => {
  const res = await CREATE(req("", { title: "להזמין בשר" }));
  await expectStatus(res, 201);
  const { task } = await res.json();
  assert.equal(task.kind, "task");
  assert.equal(task.title, "להזמין בשר");
  assert.equal(task.day, notesToday());
  assert.equal(task.done, false);
  const note = await db.note.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(note.userId, ownerId);
  const log = await db.activityLog.findFirstOrThrow({ where: { action: "note.created" } });
  assert.equal(log.actorType, "agent");
  assert.equal(log.boardId, null);
});

test("day words: tomorrow, someday, explicit date; body alias; 422 without a title", async () => {
  const t = await (await CREATE(req("", { title: "Call the bank", day: "tomorrow" }))).json();
  assert.equal(t.task.day, addDaysYmd(notesToday(), 1));
  const s = await (await CREATE(req("", { body: "Someday thing", day: "someday" }))).json();
  assert.equal(s.task.day, null);
  const d = await (await CREATE(req("", { title: "Dated", day: "2030-01-02" }))).json();
  assert.equal(d.task.day, "2030-01-02");
  await expectStatus(await CREATE(req("", { day: "today" })), 422);
  await expectStatus(await CREATE(req("", { title: "x", day: "next tuesday" })), 422);
});

test("GET /tasks filters by day and status", async () => {
  const today = (await (await LIST(req("?day=today"))).json()).tasks;
  assert.deepEqual(today.map((t: { title: string }) => t.title), ["להזמין בשר"]);
  const someday = (await (await LIST(req("?day=someday"))).json()).tasks;
  assert.deepEqual(someday.map((t: { title: string }) => t.title), ["Someday thing"]);
  await expectStatus(await LIST(req("?status=nope")), 422);
});

test("done, reopen, reschedule, rename, delete", async () => {
  const { task } = await (await CREATE(req("", { title: "Book a haircut" }))).json();
  const done = await (await DONE(req(`/${task.id}/done`, {}), ctx(task.id))).json();
  assert.equal(done.task.done, true);
  assert.equal(done.task.doneOn, notesToday());
  assert.ok(await db.activityLog.findFirst({ where: { action: "note.done" } }));
  const openNow = (await (await LIST(req("?day=today"))).json()).tasks.map((t: { id: string }) => t.id);
  assert.ok(!openNow.includes(task.id));

  const patched = await (await PATCH(req(`/${task.id}`, { done: false, day: "someday", title: "Book a haircut (Fri)" }, "PATCH"), ctx(task.id))).json();
  assert.equal(patched.task.done, false);
  assert.equal(patched.task.day, null);
  assert.equal(patched.task.title, "Book a haircut (Fri)");

  await expectStatus(await DELETE(req(`/${task.id}`, undefined, "DELETE"), ctx(task.id)), 200);
  await expectStatus(await GET_ONE(req(`/${task.id}`), ctx(task.id)), 404);
});
