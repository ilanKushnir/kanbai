import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { createTicket, updateTicket, deleteTicket, type Actor } from "./tickets";
import { listNotifications, markNotificationsRead, type NotificationScope } from "./notifications";

// "You were assigned": someone else putting you on a ticket leaves a
// notification for you; doing it yourself, or your own agent doing it, doesn't.
// Runs against the throwaway SQLite db set up by the `test` script.

type Seed = {
  boardId: string;
  privateBoardId: string;
  ilan: Actor;
  yuval: Actor;
  ilansAgent: Actor;
  workspaceAgent: Actor;
  ilanScope: NotificationScope;
  yuvalScope: NotificationScope;
};
let seed: Seed;

async function wipe() {
  await db.notification.deleteMany();
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.ticketAssignee.deleteMany();
  await db.subtask.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.agent.deleteMany();
  await db.boardAccess.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const ws = await db.workspace.create({ data: { name: "Notify WS", slug: "notify-ws" } });
  const ilan = await db.user.create({ data: { email: "ilan@notify.test", name: "Ilan" } });
  const yuval = await db.user.create({ data: { email: "yuval@notify.test", name: "Yuval" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: ilan.id, role: "owner" } });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: yuval.id, role: "member" } });
  const mkBoard = (name: string) =>
    db.board.create({
      data: { workspaceId: ws.id, name, slug: name.toLowerCase(), columns: { create: [{ name: "To Do", position: 0 }] } },
    });
  const board = await mkBoard("Shared");
  const privateBoard = await mkBoard("Private");
  await db.boardAccess.create({ data: { boardId: board.id, userId: yuval.id, level: "edit" } });
  const ilansAgent = await db.agent.create({ data: { workspaceId: ws.id, name: "Astra", ownerUserId: ilan.id } });
  const workspaceAgent = await db.agent.create({ data: { workspaceId: ws.id, name: "Hermes" } });
  seed = {
    boardId: board.id,
    privateBoardId: privateBoard.id,
    ilan: { type: "user", id: ilan.id, name: "Ilan" },
    yuval: { type: "user", id: yuval.id, name: "Yuval" },
    ilansAgent: { type: "agent", id: ilansAgent.id, name: "Astra" },
    workspaceAgent: { type: "agent", id: workspaceAgent.id, name: "Hermes" },
    ilanScope: [{ workspaceId: ws.id, isManager: true }],
    yuvalScope: [{ workspaceId: ws.id, isManager: false }],
  };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

async function clear() {
  await db.notification.deleteMany();
}

test("assigning someone else on create notifies them, not the creator", async () => {
  await clear();
  const t = await createTicket(
    { boardId: seed.boardId, title: "Review the deck", assigneeUserIds: [seed.ilan.id!, seed.yuval.id!] },
    seed.ilan,
  );
  assert.equal((await listNotifications(seed.ilan.id!, seed.ilanScope)).length, 0);
  const [n, ...rest] = await listNotifications(seed.yuval.id!, seed.yuvalScope);
  assert.equal(rest.length, 0);
  assert.equal(n.ticketId, t.id);
  assert.equal(n.ticketTitle, "Review the deck");
  assert.equal(n.actorName, "Ilan");
  assert.equal(n.boardName, "Shared");
  assert.equal(n.read, false);
});

test("taking a ticket yourself (the create default) is not news", async () => {
  await clear();
  await createTicket({ boardId: seed.boardId, title: "Mine" }, seed.yuval);
  assert.equal((await listNotifications(seed.yuval.id!, seed.yuvalScope)).length, 0);
});

test("an update notifies only the people it adds, and withdraws unseen ones it removes", async () => {
  await clear();
  const t = await createTicket({ boardId: seed.boardId, title: "Hand-off" }, seed.ilan);
  await updateTicket(t.id, { assigneeType: "user", assigneeUserIds: [seed.ilan.id!, seed.yuval.id!] }, seed.ilan);
  assert.equal((await listNotifications(seed.yuval.id!, seed.yuvalScope)).length, 1);

  // Unrelated edits and re-sending the same list add nothing.
  await updateTicket(t.id, { title: "Hand-off v2" }, seed.ilan);
  await updateTicket(t.id, { assigneeType: "user", assigneeUserIds: [seed.ilan.id!, seed.yuval.id!] }, seed.ilan);
  const list = await listNotifications(seed.yuval.id!, seed.yuvalScope);
  assert.equal(list.length, 1);
  assert.equal(list[0].ticketTitle, "Hand-off v2");

  // Taken off before seeing it: gone.
  await updateTicket(t.id, { assigneeType: "user", assigneeUserIds: [seed.ilan.id!] }, seed.ilan);
  assert.equal((await listNotifications(seed.yuval.id!, seed.yuvalScope)).length, 0);
});

test("your own agent assigning you is quiet; a workspace agent is not", async () => {
  await clear();
  await createTicket({ boardId: seed.boardId, title: "From Astra", assigneeUserIds: [seed.ilan.id!] }, seed.ilansAgent);
  assert.equal((await listNotifications(seed.ilan.id!, seed.ilanScope)).length, 0);
  await createTicket({ boardId: seed.boardId, title: "From Hermes", assigneeUserIds: [seed.ilan.id!] }, seed.workspaceAgent);
  const [n] = await listNotifications(seed.ilan.id!, seed.ilanScope);
  assert.equal(n.ticketTitle, "From Hermes");
  assert.equal(n.actorType, "agent");
});

test("mark read, and deleted or inaccessible tickets drop out", async () => {
  await clear();
  const a = await createTicket({ boardId: seed.boardId, title: "A", assigneeUserIds: [seed.yuval.id!] }, seed.ilan);
  await createTicket({ boardId: seed.boardId, title: "B", assigneeUserIds: [seed.yuval.id!] }, seed.ilan);
  let list = await listNotifications(seed.yuval.id!, seed.yuvalScope);
  assert.equal(list.length, 2);

  assert.equal(await markNotificationsRead(seed.yuval.id!, [list.find((n) => n.ticketTitle === "A")!.id]), 1);
  list = await listNotifications(seed.yuval.id!, seed.yuvalScope);
  assert.deepEqual(list.map((n) => [n.ticketTitle, n.read]).sort(), [["A", true], ["B", false]]);
  assert.equal(await markNotificationsRead(seed.yuval.id!), 1);

  await deleteTicket(a.id, seed.ilan);
  list = await listNotifications(seed.yuval.id!, seed.yuvalScope);
  assert.deepEqual(list.map((n) => n.ticketTitle), ["B"]);

  // A notification on a board Yuval can't see stays hidden from him.
  const p = await db.ticket.create({ data: { boardId: seed.privateBoardId, columnId: (await db.column.findFirstOrThrow({ where: { boardId: seed.privateBoardId } })).id, title: "Secret" } });
  await db.notification.create({ data: { userId: seed.yuval.id!, workspaceId: seed.ilanScope[0].workspaceId, ticketId: p.id, actorType: "user", actorName: "Ilan" } });
  list = await listNotifications(seed.yuval.id!, seed.yuvalScope);
  assert.deepEqual(list.map((n) => n.ticketTitle), ["B"]);
});
