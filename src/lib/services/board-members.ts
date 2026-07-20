import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import type { Actor } from "./tickets";

/**
 * Board-level sharing, layered on the existing workspace model:
 *   - workspace owners/admins ("managers") implicitly access every board;
 *   - plain members access only boards with a BoardAccess grant (view | edit).
 * This service lists a board's effective members and edits member grants.
 */

export type BoardMember = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  role: "owner" | "admin" | "member";
  /** Managers can't be revoked per-board — their access comes from the role. */
  implicit: boolean;
  /** Explicit grant level for plain members; null = no access. */
  level: "view" | "edit" | null;
};

/** Every workspace member with their effective access to this board (including "no access"). */
export async function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  const board = await db.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } });
  if (!board) throw new HttpError(404, "Board not found");
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: board.workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const grants = await db.boardAccess.findMany({ where: { boardId }, select: { userId: true, level: true } });
  const levelByUser = new Map(grants.map((g) => [g.userId, g.level as "view" | "edit"]));

  return members.map((m) => {
    const role = m.role as BoardMember["role"];
    const implicit = role === "owner" || role === "admin";
    return {
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      avatarColor: m.user.avatarColor,
      role,
      implicit,
      level: implicit ? "edit" : levelByUser.get(m.user.id) ?? null,
    };
  });
}

/** The users a ticket on this board can be assigned to: managers + granted members. */
export async function boardAssigneeUsers(boardId: string) {
  const members = await listBoardMembers(boardId);
  return members
    .filter((m) => m.implicit || m.level !== null)
    .map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl, avatarColor: m.avatarColor }));
}

/**
 * Grant, change, or revoke (level: null) a member's access to one board.
 * Managers are implicit and can't be edited here; the target must belong to
 * the board's workspace.
 */
export async function setBoardMemberAccess(
  boardId: string,
  userId: string,
  level: "view" | "edit" | null,
  actor: Actor,
) {
  const board = await db.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } });
  if (!board) throw new HttpError(404, "Board not found");
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
    select: { role: true },
  });
  if (!membership) throw new HttpError(422, "That user is not a member of this workspace");
  if (membership.role === "owner" || membership.role === "admin") {
    throw new HttpError(422, "Owners and admins already have access to every board", "implicit_access");
  }

  if (level === null) {
    await db.boardAccess.deleteMany({ where: { boardId, userId } });
  } else {
    await db.boardAccess.upsert({
      where: { boardId_userId: { boardId, userId } },
      update: { level },
      create: { boardId, userId, level },
    });
  }
  await logActivity({
    actor,
    action: level === null ? "board.access_revoked" : "board.access_granted",
    boardId,
    meta: { userId, level },
  });
}
