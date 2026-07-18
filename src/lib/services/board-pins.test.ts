import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { MAX_PINNED_BOARDS, parseUserSettings } from "@/lib/user-settings";
import { pinnedBoardIdsFor, setBoardPinned } from "./board-pins";

// Pins live in User.settings (per-user, cross-device). They must be idempotent,
// keep unrelated preferences and other-workspace pins intact, and self-prune
// ids of boards that no longer exist.

let uid: string;
let wsAId: string;
let boardA1: string;
let boardA2: string;
let boardOtherWs: string; // in a second workspace — pins there must survive edits here

async function wipe() {
  await db.activityLog.deleteMany();
  await db.boardAccess.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const user = await db.user.create({
    data: {
      email: "pinner@bp.test",
      name: "Pinner",
      settings: JSON.stringify({ defaultLanding: "notes", weekStartsOn: 1 }),
    },
  });
  uid = user.id;

  const wsA = await db.workspace.create({ data: { name: "Pins A", slug: "pins-a" } });
  const wsB = await db.workspace.create({ data: { name: "Pins B", slug: "pins-b" } });
  wsAId = wsA.id;
  await db.workspaceMember.createMany({
    data: [
      { workspaceId: wsA.id, userId: uid, role: "member" },
      { workspaceId: wsB.id, userId: uid, role: "member" },
    ],
  });

  boardA1 = (await db.board.create({ data: { workspaceId: wsA.id, name: "A1", slug: "a1" } })).id;
  boardA2 = (await db.board.create({ data: { workspaceId: wsA.id, name: "A2", slug: "a2" } })).id;
  boardOtherWs = (await db.board.create({ data: { workspaceId: wsB.id, name: "B1", slug: "b1" } })).id;
});

after(async () => {
  await wipe();
  await db.$disconnect();
});

test("starts empty; pinning persists in pin order and is idempotent", async () => {
  assert.deepEqual(await pinnedBoardIdsFor(uid), []);

  assert.deepEqual(await setBoardPinned(uid, boardA1, true), [boardA1]);
  assert.deepEqual(await setBoardPinned(uid, boardOtherWs, true), [boardA1, boardOtherWs]);
  assert.deepEqual(await setBoardPinned(uid, boardA1, true), [boardA1, boardOtherWs]); // no dup

  assert.deepEqual(await pinnedBoardIdsFor(uid), [boardA1, boardOtherWs]);
});

test("pins ride along in User.settings without disturbing other preferences", async () => {
  const settings = parseUserSettings(
    (await db.user.findUnique({ where: { id: uid }, select: { settings: true } }))?.settings,
  );
  assert.equal(settings.defaultLanding, "notes");
  assert.equal(settings.weekStartsOn, 1);
  assert.deepEqual(settings.pinnedBoardIds, [boardA1, boardOtherWs]);
});

test("unpinning one board leaves other pins (incl. other workspaces) alone", async () => {
  assert.deepEqual(await setBoardPinned(uid, boardA1, false), [boardOtherWs]);
  assert.deepEqual(await setBoardPinned(uid, boardA1, false), [boardOtherWs]); // idempotent
  assert.deepEqual(await pinnedBoardIdsFor(uid), [boardOtherWs]);
});

test("ids of deleted boards are pruned on the next write", async () => {
  const doomed = (
    await db.board.create({ data: { workspaceId: wsAId, name: "Doomed", slug: "doomed" } })
  ).id;
  await setBoardPinned(uid, doomed, true);
  await db.board.delete({ where: { id: doomed } });

  assert.deepEqual(await setBoardPinned(uid, boardA2, true), [boardOtherWs, boardA2]);
});

test("pinning a nonexistent board is a no-op (route-level access checks run first)", async () => {
  assert.deepEqual(await setBoardPinned(uid, "brd_missing", true), [boardOtherWs, boardA2]);
});

test("unknown user rejects with 404", async () => {
  await assert.rejects(
    () => setBoardPinned("usr_missing", boardA1, true),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
});

test("pinning past the cap rejects with 422 instead of silently reverting", async () => {
  // Fill the pin list to the cap with real boards (parse would drop fakes).
  const ws = await db.workspace.create({ data: { name: "Pins cap", slug: "pins-cap" } });
  await db.board.createMany({
    data: Array.from({ length: MAX_PINNED_BOARDS }, (_, i) => ({
      workspaceId: ws.id,
      name: `Cap ${i}`,
      slug: `cap-${i}`,
    })),
  });
  const capIds = (await db.board.findMany({ where: { workspaceId: ws.id }, select: { id: true } })).map(
    (b) => b.id,
  );
  await db.user.update({
    where: { id: uid },
    data: { settings: JSON.stringify({ pinnedBoardIds: capIds }) },
  });

  await assert.rejects(
    () => setBoardPinned(uid, boardA1, true),
    (e: unknown) => e instanceof HttpError && e.status === 422 && e.code === "pin_limit",
  );
  // Re-pinning something already pinned and unpinning both still work at the cap.
  assert.equal((await setBoardPinned(uid, capIds[0], true)).length, MAX_PINNED_BOARDS);
  assert.equal((await setBoardPinned(uid, capIds[0], false)).length, MAX_PINNED_BOARDS - 1);
});
