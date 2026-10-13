import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { listActivity } from "./activity-feed";
import { createTicket, moveTicketToDone, addComment } from "./tickets";
import { createNote, updateNote } from "./notes";
import { createBoard, updateBoard } from "./boards";

// listActivity joins ActivityLog rows with ticket / board / note context and
// honors the actorType / boardId / since / limit filters.

let wsId: string;
let userId: string;

async function wipe() {
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.comment.deleteMany();
  await db.ticket.deleteMany();
  await db.note.deleteMany();
  await db.column.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const u = await db.user.create({ data: { email: "ilan@feed.test", name: "Ilan" } });
  userId = u.id;
  const ws = await db.workspace.create({
    data: { name: "Feed WS", slug: "feed-ws", ownerId: u.id, members: { create: { userId: u.id, role: "owner" } } },
  });
  wsId = ws.id;
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("every service mutation lands in the feed with context", async () => {
  const astra = { type: "agent" as const, id: "agt_astra", name: "Astra" };
  const ilan = { type: "user" as const, id: userId, name: "Ilan" };

  const board = await createBoard(wsId, { name: "Chores" }, ilan);
  const t = await createTicket({ boardId: board.id, title: "Take out trash", column: "Backlog" }, astra);
  await addComment(t.id, "Done after dinner", astra);
  await moveTicketToDone(t.id, astra);
  const n = await createNote(userId, "Call mom", { scheduledDay: null }, ilan);
  await updateNote(n.id, { doneOn: "2026-10-14" }, astra);
  await updateBoard(board.id, { archived: true }, astra);

  const all = await listActivity({ workspaceId: wsId, limit: 50 });
  assert.deepEqual(
    all.map((a) => a.action),
    ["board.archived", "note.done", "note.created", "ticket.done", "comment.created", "ticket.created", "board.created"],
  );
  const done = all.find((a) => a.action === "ticket.done")!;
  assert.deepEqual(
    { actor: done.actorName, type: done.actorType, title: done.ticket?.title, number: done.ticket?.number, slug: done.ticket?.boardSlug, board: done.board?.name },
    { actor: "Astra", type: "agent", title: "Take out trash", number: 1, slug: "chores", board: "Chores" },
  );
  assert.equal(done.meta.to, "Done");
  const noteDone = all.find((a) => a.action === "note.done")!;
  assert.deepEqual(noteDone.note, { id: n.id, body: "Call mom" });
  assert.equal(noteDone.board, undefined);
  assert.match(done.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  // Filters.
  const agentsOnly = await listActivity({ workspaceId: wsId, actorType: "agent" });
  assert.ok(agentsOnly.every((a) => a.actorType === "agent"));
  assert.equal(agentsOnly.length, 5);
  const users = await listActivity({ workspaceId: wsId, actorType: "user" });
  assert.deepEqual(users.map((a) => a.action), ["note.created", "board.created"]);
  const onBoard = await listActivity({ workspaceId: wsId, boardId: board.id });
  assert.ok(onBoard.every((a) => a.board?.id === board.id));
  assert.equal(onBoard.length, 5);
  assert.equal((await listActivity({ workspaceId: wsId, limit: 2 })).length, 2);
  const since = await listActivity({ workspaceId: wsId, since: new Date(Date.now() + 60_000).toISOString() });
  assert.deepEqual(since, []);

  // A board-scoped cap hides other boards' rows but keeps workspace-wide note rows.
  const capped = await listActivity({ workspaceId: wsId, boardIds: [] });
  assert.deepEqual(capped.map((a) => a.action), ["note.done", "note.created"]);
});
