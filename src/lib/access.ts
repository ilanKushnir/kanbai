import { db } from "./db";
import { HttpError } from "./api";

// Workspace-scoped guards — used by the AGENT API (agents have full
// access to everything in their workspace; no per-board restriction).

export async function assertBoardInWorkspace(boardId: string, workspaceId: string) {
  const board = await db.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } });
  if (!board || board.workspaceId !== workspaceId) throw new HttpError(404, "Board not found");
}

export async function assertTicketInWorkspace(ticketId: string, workspaceId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { board: { select: { workspaceId: true } } },
  });
  if (!ticket || ticket.board.workspaceId !== workspaceId) throw new HttpError(404, "Ticket not found");
}

export async function assertAgentInWorkspace(agentId: string, workspaceId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
  if (!agent || agent.workspaceId !== workspaceId) throw new HttpError(404, "Agent not found");
}

export async function assertColumnInWorkspace(columnId: string, workspaceId: string) {
  const col = await db.column.findUnique({
    where: { id: columnId },
    select: { board: { select: { workspaceId: true } } },
  });
  if (!col || col.board.workspaceId !== workspaceId) throw new HttpError(404, "Column not found");
}

/**
 * The column must both live in the agent's workspace AND belong to the named
 * board — guards the nested `/boards/{boardId}/columns/{columnId}` route so a
 * caller can't patch a column on a board they didn't address.
 */
export async function assertColumnInBoard(columnId: string, boardId: string, workspaceId: string) {
  const col = await db.column.findUnique({
    where: { id: columnId },
    select: { boardId: true, board: { select: { workspaceId: true } } },
  });
  if (!col || col.board.workspaceId !== workspaceId || col.boardId !== boardId) {
    throw new HttpError(404, "Column not found");
  }
}
