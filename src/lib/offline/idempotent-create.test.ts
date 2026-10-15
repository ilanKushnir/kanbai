import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { createNote } from "@/lib/services/notes";
import { createTicket } from "@/lib/services/tickets";
import { createNoteSchema, createTicketSchema } from "@/lib/validation";
import { clientId } from "./today-sync";

// The offline outbox retries a create whose response was lost. With a
// client-generated id the retry returns the row already made — never a twin.

let userId: string;
let otherId: string;
let boardId: string;
let columnId: string;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.board.deleteMany();
  await db.note.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const user = await db.user.create({ data: { email: "me@offline.test", name: "Me" } });
  const other = await db.user.create({ data: { email: "other@offline.test", name: "Other" } });
  userId = user.id;
  otherId = other.id;
  const ws = await db.workspace.create({
    data: { name: "WS", slug: "offline-ws", ownerId: user.id, members: { create: [{ userId: user.id, role: "owner" }, { userId: other.id, role: "member" }] } },
  });
  const board = await db.board.create({
    data: {
      workspaceId: ws.id,
      name: "Home",
      slug: "home",
      columns: { create: [{ name: "To do", position: 0 }, { name: "Done", position: 1, isDone: true }] },
    },
    include: { columns: true },
  });
  boardId = board.id;
  columnId = board.columns.find((c) => !c.isDone)!.id;
});

after(wipe);

test("client ids are the shape the API accepts", () => {
  for (let i = 0; i < 50; i++) {
    const id = clientId();
    assert.ok(createNoteSchema.safeParse({ id, body: "x" }).success, id);
    assert.ok(createTicketSchema.safeParse({ id, boardId: "b", title: "x" }).success, id);
  }
  assert.equal(createNoteSchema.safeParse({ id: "../etc", body: "x" }).success, false);
});

test("a retried note create returns the same note, once", async () => {
  const id = clientId();
  const a = await createNote(userId, "Buy milk", { scheduledDay: "2026-10-15", id });
  const b = await createNote(userId, "Buy milk", { scheduledDay: "2026-10-15", id });
  assert.equal(a.id, id);
  assert.equal(b.id, id);
  assert.equal(await db.note.count({ where: { body: "Buy milk" } }), 1);
});

test("someone else's id is refused", async () => {
  const id = clientId();
  await createNote(userId, "Mine", { id });
  await assert.rejects(createNote(otherId, "Theirs", { id }), /409|in use/i);
});

test("a retried ticket create returns the same ticket and number", async () => {
  const id = clientId();
  const actor = { type: "user" as const, id: userId, name: "Me" };
  const a = await createTicket({ id, boardId, columnId, title: "Call the bank" }, actor);
  const b = await createTicket({ id, boardId, columnId, title: "Call the bank" }, actor);
  assert.equal(a.id, id);
  assert.equal(b.id, id);
  assert.equal(b.number, a.number);
  assert.equal(await db.ticket.count({ where: { title: "Call the bank" } }), 1);
});
