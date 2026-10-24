import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { hashApiKey } from "@/lib/crypto";
import { POST, GET as LIST } from "./route";
import { GET as LIST_BOARDS } from "../boards/route";
import { GET as GET_BOARD, PATCH as PATCH_BOARD } from "../boards/[boardId]/route";
import { listActivity } from "@/lib/services/activity-feed";
import { listNotifications } from "@/lib/services/notifications";

// A board shared across workspaces: Ilan owns a "Home" board in his
// workspace and shared it with Yuval. Yuval's agent lives in HER workspace.
// It must reach that board exactly as Yuval can in the app, file a ticket
// for Ilan there, and Ilan must see it — in his bell and in Recent changes
// as "Mika · Yuval added … for you".
// Runs against the throwaway SQLite db set up by the `test` script.

const MIKA_KEY = "kbai_live_shared_mika_key_00000000000";

type Seed = { ilan: string; yuval: string; ilanWs: string; homeId: string; privateId: string; mikaId: string };
let seed: Seed;

function call(url: string, method = "GET", body?: unknown) {
  return new Request(`http://test.local/api/v1${url}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${MIKA_KEY}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

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
  const ilan = await db.user.create({ data: { email: "ilan@shared.test", name: "Ilan" } });
  const yuval = await db.user.create({ data: { email: "yuval@shared.test", name: "Yuval" } });
  const ilanWs = await db.workspace.create({ data: { name: "Ilan's", slug: "ilan-shared" } });
  const yuvalWs = await db.workspace.create({ data: { name: "Yuval's", slug: "yuval-shared" } });
  await db.workspaceMember.create({ data: { workspaceId: ilanWs.id, userId: ilan.id, role: "owner" } });
  await db.workspaceMember.create({ data: { workspaceId: ilanWs.id, userId: yuval.id, role: "member" } });
  await db.workspaceMember.create({ data: { workspaceId: yuvalWs.id, userId: yuval.id, role: "owner" } });
  const mk = (name: string) =>
    db.board.create({
      data: { workspaceId: ilanWs.id, name, slug: name.toLowerCase(), columns: { create: [{ name: "Backlog", position: 0 }, { name: "Done", position: 1, isDone: true }] } },
    });
  const home = await mk("Home");
  const priv = await mk("Private");
  await db.boardAccess.create({ data: { boardId: home.id, userId: yuval.id, level: "edit" } });
  const mika = await db.agent.create({
    data: {
      workspaceId: yuvalWs.id,
      name: "Mika",
      ownerUserId: yuval.id,
      apiKeyHash: hashApiKey(MIKA_KEY),
      scopes: "boards:read,boards:write,tickets:read,tickets:write",
    },
  });
  seed = { ilan: ilan.id, yuval: yuval.id, ilanWs: ilanWs.id, homeId: home.id, privateId: priv.id, mikaId: mika.id };
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("the shared board is in the agent's board list, with its people", async () => {
  const res = await LIST_BOARDS(call("/boards"));
  assert.equal(res.status, 200);
  const { boards } = (await res.json()) as { boards: { id: string; shared: boolean; people: { id: string; name: string }[] }[] };
  assert.deepEqual(boards.map((b) => b.id), [seed.homeId]); // not the board that wasn't shared
  assert.equal(boards[0].shared, true);
  assert.deepEqual(boards[0].people.map((p) => p.name).sort(), ["Ilan", "Yuval"]);

  const one = await GET_BOARD(call(`/boards/${seed.homeId}`), { params: Promise.resolve({ boardId: seed.homeId }) });
  assert.equal(one.status, 200);
  assert.equal((await GET_BOARD(call(`/boards/${seed.privateId}`), { params: Promise.resolve({ boardId: seed.privateId }) })).status, 404);
});

test("the agent files a ticket for Ilan on the shared board; Ilan is told", async () => {
  const res = await POST(call("/tickets", "POST", { boardId: seed.homeId, title: "Fix the gate", assigneeUserId: seed.ilan }));
  assert.equal(res.status, 201, await res.clone().text());
  const { ticket } = (await res.json()) as { ticket: { id: string } };

  const [n] = await listNotifications(seed.ilan, [{ workspaceId: seed.ilanWs, isManager: true }]);
  assert.equal(n.ticketId, ticket.id);
  assert.equal(n.actorName, "Mika · Yuval");
  assert.equal(n.actorType, "agent");

  const feed = await listActivity({ workspaceId: seed.ilanWs, limit: 10 });
  const created = feed.find((a) => a.action === "ticket.created" && a.ticket?.id === ticket.id)!;
  assert.equal(created.actorName, "Mika");
  assert.equal(created.actorOwnerName, "Yuval");
  assert.deepEqual(created.meta.assigneeIds, [seed.ilan]);

  // And it shows up in the agent's own ticket list.
  const list = (await (await LIST(call("/tickets"))).json()) as { tickets: { id: string }[] };
  assert.ok(list.tickets.some((t) => t.id === ticket.id));
});

test("boards the owner can't open stay closed, and a shared board's settings stay with its workspace", async () => {
  const res = await POST(call("/tickets", "POST", { boardId: seed.privateId, title: "Nope" }));
  assert.equal(res.status, 404);
  const patch = await PATCH_BOARD(call(`/boards/${seed.homeId}`, "PATCH", { name: "Renamed" }), { params: Promise.resolve({ boardId: seed.homeId }) });
  assert.equal(patch.status, 403);
});
