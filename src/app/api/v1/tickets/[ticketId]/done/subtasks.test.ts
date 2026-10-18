import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { POST as CREATE } from "../../route";
import { POST as DONE } from "./route";

// Tickets: an agent creates one with its subtasks (a "- [ ]" checklist in the
// description is lifted into them), and closing it ticks them unless told not to.

const KEY = "kbai_live_ticketsubs_key_000000000000";
let boardId: string;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.subtask.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.agent.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}
function req(body: unknown) {
  return new Request("http://test.local/api/v1/tickets", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
}
const ctx = (ticketId: string) => ({ params: Promise.resolve({ ticketId }) });

before(async () => {
  await wipe();
  const owner = await db.user.create({ data: { email: "owner@ticketsubs.test", name: "Owner" } });
  const ws = await db.workspace.create({
    data: { name: "TS WS", slug: "ticketsubs-ws", ownerId: owner.id, members: { create: { userId: owner.id, role: "owner" } } },
  });
  const board = await db.board.create({
    data: { workspaceId: ws.id, name: "Rack", slug: "rack-ts", columns: { create: [{ name: "Backlog", position: 0 }, { name: "Done", position: 1, isDone: true }] } },
  });
  boardId = board.id;
  await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "boards:read,tickets:read,tickets:write" } });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("create with subtasks (+ lifted checklist); done ticks them; completeSubtasks:false keeps them", async () => {
  const res = await CREATE(req({ boardId, title: "LED add-on", description: "Plan:\n- [ ] Pick LEDs", subtasks: ["Print the mount"] }));
  assert.equal(res.status, 201, await res.clone().text());
  const { ticket } = await res.json();
  assert.equal(ticket.description.includes("[ ]"), false);
  assert.deepEqual(ticket.subtasks.map((s: { title: string }) => s.title), ["Pick LEDs", "Print the mount"]);

  const done = await (await DONE(req({}), ctx(ticket.id))).json();
  assert.equal(done.ticket.isDone, true);
  assert.ok(done.ticket.subtasks.every((s: { completed: boolean }) => s.completed));

  const { ticket: t2 } = await (await CREATE(req({ boardId, title: "Second", subtasks: ["One"] }))).json();
  const kept = await (await DONE(req({ completeSubtasks: false }), ctx(t2.id))).json();
  assert.equal(kept.ticket.isDone, true);
  assert.equal(kept.ticket.subtasks[0].completed, false);
});
