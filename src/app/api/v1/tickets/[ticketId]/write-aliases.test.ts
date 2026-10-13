import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { workspaceTz, zonedTime } from "@/lib/tz";
import { POST as CREATE } from "../route";
import { PATCH } from "./route";
import { POST as MOVE } from "./move/route";
import { POST as DONE } from "./done/route";
import { POST as COMMENT } from "./comments/route";
import { POST as ADD_SUBTASK } from "./subtasks/route";

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) assert.fail(`expected ${status}, got ${res.status}: ${await res.text()}`);
}

// Forgiving write aliases on the agent API: move by column name / stage with
// an optional position, PATCH with labelNames / column / stage, comments with
// `content`, date-only dueDates, subtask writes returning { subtask, ticket },
// and the activity rows (ticket.done etc.) every mutation leaves behind.

const KEY = "kbai_live_alias_key_000000000000000000";

let boardId: string;
let cols: Record<string, string> = {};

function req(body: unknown, method = "POST") {
  return new Request("http://test.local/api/v1/tickets", {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
}
const ctx = (ticketId: string) => ({ params: Promise.resolve({ ticketId }) });

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.subtask.deleteMany();
  await db.comment.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.agent.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const ws = await db.workspace.create({ data: { name: "Alias WS", slug: "alias-ws" } });
  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Home",
      slug: "home",
      columns: {
        create: [
          { name: "Ideas", position: 0, stage: "intake" },
          { name: "Backlog", position: 1, stage: "backlog" },
          { name: "In Work", position: 2, stage: "active", subStates: JSON.stringify(["Doing", "Blocked"]) },
          { name: "Done", position: 3, isDone: true, stage: "done" },
        ],
      },
      labels: { create: [{ name: "Errand", color: "amber" }] },
    },
    include: { columns: true },
  });
  boardId = board.id;
  cols = Object.fromEntries(board.columns.map((c) => [c.name, c.id]));
  await db.agent.create({
    data: { workspaceId: ws.id, name: "Astra", apiKeyHash: hashApiKey(KEY), scopes: "tickets:read,tickets:write,comments:write" },
  });
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

async function create(body: Record<string, unknown>) {
  const res = await CREATE(req({ boardId, title: "T", ...body }));
  await expectStatus(res, 201);
  return (await res.json()).ticket;
}

const actions = async (ticketId: string) =>
  (await db.activityLog.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } })).map((r) => r.action);

test("create: column by name (case-insensitive) or stage, labelNames auto-created, date-only dueDate", async () => {
  const t = await create({ column: "backlog", labelNames: ["errand", "Dentist"], dueDate: "2026-10-20" });
  assert.equal(t.columnId, cols.Backlog);
  assert.deepEqual(t.labels.map((l: { name: string }) => l.name).sort(), ["Dentist", "Errand"]);
  assert.equal(await db.label.count({ where: { boardId } }), 2); // "errand" matched the existing label
  assert.equal(t.dueDate, zonedTime("2026-10-20", 12, 0, workspaceTz()).toISOString());

  const byStage = await create({ stage: "active" });
  assert.equal(byStage.columnId, cols["In Work"]);
  assert.equal(byStage.subState, "Doing"); // first sub-state of the column

  const miss = await CREATE(req({ boardId, title: "x", column: "Nope" }));
  assert.equal(miss.status, 422);
  const err = (await miss.json()).error;
  assert.equal(err.code, "column_not_found");
  assert.match(err.message, /Ideas, Backlog, In Work, Done/);
});

test("move: by column name / stage, position defaults to the end, subState passes through, ticket.done is logged", async () => {
  const a = await create({ column: "Ideas", title: "A" });
  const b = await create({ column: "Ideas", title: "B" });

  let res = await MOVE(req({ column: "in work" }), ctx(a.id));
  await expectStatus(res, 200);
  let { ticket } = await res.json();
  assert.equal(ticket.columnId, cols["In Work"]);

  res = await MOVE(req({ column: "In Work", subState: "Blocked" }), ctx(b.id));
  ({ ticket } = await res.json());
  assert.equal(ticket.subState, "Blocked");
  // Appended after A (position default = end of column, within the band order).
  const order = await db.ticket.findMany({ where: { columnId: cols["In Work"] }, orderBy: { position: "asc" }, select: { title: true } });
  assert.deepEqual(order.map((t) => t.title).slice(-2), ["A", "B"]);

  res = await MOVE(req({ stage: "done" }), ctx(a.id));
  ({ ticket } = await res.json());
  assert.equal(ticket.columnId, cols.Done);
  assert.equal(ticket.isDone, true);
  assert.ok(ticket.completedAt);
  assert.deepEqual(await actions(a.id), ["ticket.created", "ticket.moved", "ticket.done"]);

  // Leaving the done column reopens and clears completedAt.
  res = await MOVE(req({ column: "Backlog", position: 0 }), ctx(a.id));
  ({ ticket } = await res.json());
  assert.equal(ticket.completedAt, null);
  assert.equal((await actions(a.id)).at(-1), "ticket.reopened");

  const nothing = await MOVE(req({ position: 0 }), ctx(a.id));
  assert.equal(nothing.status, 422);
});

test("POST /done moves to the done column and logs ticket.done", async () => {
  const t = await create({ title: "Finish me" });
  const res = await DONE(req({}), ctx(t.id));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ticket.columnId, cols.Done);
  assert.deepEqual(await actions(t.id), ["ticket.created", "ticket.done"]);
});

test("PATCH: labelNames replaces the full set (creating missing), column/stage moves, dueDate null clears", async () => {
  const t = await create({ labelNames: ["Errand"], dueDate: "2026-10-20" });
  let res = await PATCH(req({ labelNames: ["Urgent", "errand"] }, "PATCH"), ctx(t.id));
  await expectStatus(res, 200);
  let { ticket } = await res.json();
  assert.deepEqual(ticket.labels.map((l: { name: string }) => l.name).sort(), ["Errand", "Urgent"]);

  res = await PATCH(req({ labelNames: [] }, "PATCH"), ctx(t.id));
  ({ ticket } = await res.json());
  assert.deepEqual(ticket.labels, []);

  res = await PATCH(req({ stage: "active", priority: "high", dueDate: null }, "PATCH"), ctx(t.id));
  ({ ticket } = await res.json());
  assert.equal(ticket.columnId, cols["In Work"]);
  assert.equal(ticket.priority, "high");
  assert.equal(ticket.dueDate, null);

  res = await PATCH(req({ column: "DONE" }, "PATCH"), ctx(t.id));
  ({ ticket } = await res.json());
  assert.equal(ticket.columnId, cols.Done);
  assert.ok((await actions(t.id)).includes("ticket.done"));
});

test("comments accept content as an alias of body and log comment.created", async () => {
  const t = await create({ title: "Chatty" });
  const res = await COMMENT(req({ content: "Booked for Tuesday." }), ctx(t.id));
  await expectStatus(res, 201);
  const { comment } = await res.json();
  assert.equal(comment.body, "Booked for Tuesday.");
  assert.equal(comment.authorName, "Astra");
  const empty = await COMMENT(req({}), ctx(t.id));
  assert.equal(empty.status, 422);
  const row = await db.activityLog.findFirst({ where: { ticketId: t.id, action: "comment.created" } });
  assert.ok(row);
  assert.equal(row!.actorType, "agent");
  assert.equal(row!.actorName, "Astra");
});

test("subtask writes return { subtask, ticket }", async () => {
  const t = await create({ title: "With steps" });
  const res = await ADD_SUBTASK(req({ title: "Step one" }), ctx(t.id));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["subtask", "ticket"]);
  assert.equal(body.subtask.title, "Step one");
  assert.equal(body.subtask.completed, false);
  assert.equal(body.ticket.subtasks.length, 1);
  assert.equal(body.ticket.subtasks[0].id, body.subtask.id);
});
