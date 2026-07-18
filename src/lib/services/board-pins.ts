import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { MAX_PINNED_BOARDS, parseUserSettings } from "@/lib/user-settings";

/**
 * Per-user pinned boards, stored in the User.settings JSON blob so pins follow
 * the user across devices (unlike the per-board localStorage view mode).
 * Pins are personal bookmarks, not board state: they never affect what a user
 * may see — visibility stays governed by workspace role / BoardAccess at read
 * time, and the Boards page simply ignores pin ids it can't show.
 */

/** The user's pinned board ids, in the order they were pinned. */
export async function pinnedBoardIdsFor(userId: string): Promise<string[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } });
  return parseUserSettings(user?.settings).pinnedBoardIds;
}

/**
 * Pin or unpin one board for one user (idempotent); returns the updated list.
 * Callers must have checked the user may access the board. Ids of boards that
 * were deleted since being pinned are pruned on the way through; pins for the
 * user's other workspaces are left untouched.
 */
export async function setBoardPinned(
  userId: string,
  boardId: string,
  pinned: boolean,
): Promise<string[]> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } });
  if (!user) throw new HttpError(404, "User not found");

  const settings = parseUserSettings(user.settings);
  const already = settings.pinnedBoardIds.includes(boardId);
  if (pinned && !already && settings.pinnedBoardIds.length >= MAX_PINNED_BOARDS) {
    // Parsing caps at MAX_PINNED_BOARDS, so an over-cap write would silently
    // drop this pin on the next read — reject it loudly instead.
    throw new HttpError(422, `You can pin up to ${MAX_PINNED_BOARDS} boards.`, "pin_limit");
  }
  const next = pinned
    ? already
      ? settings.pinnedBoardIds
      : [...settings.pinnedBoardIds, boardId]
    : settings.pinnedBoardIds.filter((id) => id !== boardId);

  const existing = new Set(
    (await db.board.findMany({ where: { id: { in: next } }, select: { id: true } })).map((b) => b.id),
  );
  settings.pinnedBoardIds = next.filter((id) => existing.has(id));

  await db.user.update({ where: { id: userId }, data: { settings: JSON.stringify(settings) } });
  return settings.pinnedBoardIds;
}
