import { db } from "./db";
import { HttpError } from "./api";
import type { Context } from "./auth";

/** Prisma `where` for the boards the current user may see in the active workspace. */
export function boardWhereForContext(ctx: Context) {
  if (ctx.isManager) return { workspaceId: ctx.workspace.id, archived: false };
  return {
    workspaceId: ctx.workspace.id,
    archived: false,
    access: { some: { userId: ctx.user.id } },
  };
}

/** Throws unless the user can access the board (404 if not in workspace, 403 if no grant / view-only on write). */
export async function assertBoardAccess(ctx: Context, boardId: string, write = false) {
  const board = await db.board.findUnique({
    where: { id: boardId },
    select: {
      workspaceId: true,
      access: { where: { userId: ctx.user.id }, select: { level: true } },
    },
  });
  if (!board || board.workspaceId !== ctx.workspace.id) throw new HttpError(404, "Board not found");
  if (ctx.isManager) return;
  const grant = board.access[0];
  if (!grant) throw new HttpError(403, "You don't have access to this board.", "no_board_access");
  if (write && grant.level !== "edit") {
    throw new HttpError(403, "You have view-only access to this board.", "view_only");
  }
}

export async function assertTicketAccess(ctx: Context, ticketId: string, write = false) {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { boardId: true } });
  if (!ticket) throw new HttpError(404, "Ticket not found");
  await assertBoardAccess(ctx, ticket.boardId, write);
}

export async function assertColumnAccess(ctx: Context, columnId: string, write = false) {
  const col = await db.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
  if (!col) throw new HttpError(404, "Column not found");
  await assertBoardAccess(ctx, col.boardId, write);
}
