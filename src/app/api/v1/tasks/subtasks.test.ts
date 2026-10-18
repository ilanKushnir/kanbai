import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { POST as CREATE } from "./route";
import { PATCH as PATCH_TASK } from "./[taskId]/route";
import { POST as DONE } from "./[taskId]/done/route";
import { GET as LIST_SUBS, POST as ADD_SUBS } from "./[taskId]/subtasks/route";
import { PATCH as PATCH_SUB, DELETE as DELETE_SUB } from "./[taskId]/subtasks/[subtaskId]/route";
import { listNotesForUser } from "@/lib/services/notes";

// Simple tasks carry subtasks: on create, appended later, ticked, removed;
// completing the task ticks them unless asked not to; a "- [ ]" checklist in
// the text is lifted into real subtasks.

const KEY = "kbai_live_tasksubs_key_00000000000000";
let ownerId: string;

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) assert.fail(`expected ${status}, got ${res.status}: ${await res.text()}`);
}
function req(body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request("http://test.local/api/v1/tasks", {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ctx = (taskId: string, subtaskId = "") => ({ params: Promise.resolve({ taskId, subtaskId }) });

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
  const owner = await db.user.create({ data: { email: "owner@tasksubs.test", name: "Owner" } });
  ownerId = owner.id;
  const ws = await db.workspace.create({
    data: { name: "Subs WS", slug: "tasksubs-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "notes:read,notes:write" } });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("create with subtasks, append, tick, rename, delete", async () => {
  const res = await CREATE(req({ title: "Set up the phone", subtasks: ["Buy a SIM", "Connect WhatsApp"] }));
  await expectStatus(res, 201);
  const { task } = await res.json();
  assert.deepEqual(task.subtasks.map((s: { title: string; completed: boolean }) => [s.title, s.completed]), [["Buy a SIM", false], ["Connect WhatsApp", false]]);

  const added = await ADD_SUBS(req({ titles: ["Home Assistant"] }), ctx(task.id));
  await expectStatus(added, 201);
  const a = await added.json();
  assert.equal(a.subtasks.length, 1);
  assert.equal(a.task.subtasks.length, 3);

  const first = task.subtasks[0].id;
  const ticked = await (await PATCH_SUB(req({ completed: true }, "PATCH"), ctx(task.id, first))).json();
  assert.equal(ticked.subtask.completed, true);
  await PATCH_SUB(req({ title: "Buy an eSIM" }, "PATCH"), ctx(task.id, first));
  const list = (await (await LIST_SUBS(req(), ctx(task.id))).json()).subtasks;
  assert.deepEqual(list[0], { id: first, title: "Buy an eSIM", completed: true });

  await expectStatus(await DELETE_SUB(req(undefined, "DELETE"), ctx(task.id, list[1].id)), 200);
  await expectStatus(await DELETE_SUB(req(undefined, "DELETE"), ctx(task.id, list[1].id)), 404);
  const after = (await (await LIST_SUBS(req(), ctx(task.id))).json()).subtasks;
  assert.deepEqual(after.map((s: { title: string }) => s.title), ["Buy an eSIM", "Home Assistant"]);
});

test("done ticks open subtasks by default; completeSubtasks:false keeps them", async () => {
  const { task } = await (await CREATE(req({ title: "Trip", subtasks: ["Hotel", "Flights"] }))).json();
  const done = await (await DONE(req({}), ctx(task.id))).json();
  assert.equal(done.task.done, true);
  assert.ok(done.task.subtasks.every((s: { completed: boolean }) => s.completed));

  const { task: t2 } = await (await CREATE(req({ title: "Trip 2", subtasks: ["Hotel"] }))).json();
  const kept = await (await PATCH_TASK(req({ done: true, completeSubtasks: false }, "PATCH"), ctx(t2.id))).json();
  assert.equal(kept.task.done, true);
  assert.equal(kept.task.subtasks[0].completed, false);
});

test("a markdown checklist in the text becomes subtasks (new and legacy tasks)", async () => {
  const { task } = await (await CREATE(req({ title: "Yuvalochi\n\nFirst:\n- [ ] Buy a number\n- [ ] WhatsApp" }))).json();
  assert.equal(task.title, "Yuvalochi");
  assert.deepEqual(task.subtasks.map((s: { title: string }) => s.title), ["Buy a number", "WhatsApp"]);

  // Written before subtasks existed: lifted the next time the list is read.
  const legacy = await db.note.create({ data: { userId: ownerId, body: "Old one\n- [x] done part\n- [ ] open part" } });
  const notes = await listNotesForUser(ownerId);
  const n = notes.find((x) => x.id === legacy.id)!;
  assert.equal(n.body, "Old one");
  assert.deepEqual(n.subtasks.map((s) => [s.title, s.completed]), [["done part", true], ["open part", false]]);
});
