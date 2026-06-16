import { db } from "./db";
import { HttpError } from "./api";

export async function assertBoardAccess(boardId: string, workspaceId: string) {
  const board = await db.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } });
  if (!board || board.workspaceId !== workspaceId) throw new HttpError(404, "Board not found");
}

export async function assertTicketAccess(ticketId: string, workspaceId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { board: { select: { workspaceId: true } } },
  });
  if (!ticket || ticket.board.workspaceId !== workspaceId) throw new HttpError(404, "Ticket not found");
}

export async function assertAgentAccess(agentId: string, workspaceId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
  if (!agent || agent.workspaceId !== workspaceId) throw new HttpError(404, "Agent not found");
}
