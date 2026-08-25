import { db } from "./db";
import { HttpError } from "./api";

// Workspace-scoped guards — used by the AGENT API. Agents without an owning
// user see everything in their workspace; agents with `ownerUserId` set are
// capped to the boards that user can access (managers → all, members → their
// BoardAccess grants).

type AgentPrincipal = { workspaceId: string; ownerUserId?: string | null };

/**
 * The board ids an agent may act on, or null meaning "every board in its
 * workspace" (legacy agent with no owner, or an owner who is a manager).
 * An owner who left the workspace yields [] — no access at all.
 */
export async function agentAccessibleBoardIds(agent: AgentPrincipal): Promise<string[] | null> {
  if (!agent.ownerUserId) return null;
  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId: agent.workspaceId, userId: agent.ownerUserId },
    select: { role: true },
  });
  if (!membership) return [];
  if (membership.role === "owner" || membership.role === "admin") return null;
  const grants = await db.boardAccess.findMany({
    where: { userId: agent.ownerUserId, board: { workspaceId: agent.workspaceId } },
    select: { boardId: true },
  });
  return grants.map((g) => g.boardId);
}

/**
 * Whether the agent may act with workspace-manager authority. An agent with no
 * owner represents the workspace itself (legacy/manager-provisioned); an owned
 * agent inherits its owner's authority, so member management is allowed only
 * when that owner is a workspace owner/admin. This closes the escalation where
 * an agent owned by a plain member could promote members or edit roles.
 */
export async function agentHasManagerAuthority(agent: AgentPrincipal): Promise<boolean> {
  if (!agent.ownerUserId) return true;
  const m = await db.workspaceMember.findFirst({
    where: { workspaceId: agent.workspaceId, userId: agent.ownerUserId },
    select: { role: true },
  });
  return m?.role === "owner" || m?.role === "admin";
}

/**
 * For per-user private data (notes): the single userId an owned, non-manager
 * agent is confined to, or null meaning "the whole workspace" (no owner, or an
 * owner with manager authority). Mirrors the board cap for notes, which are
 * strictly per-user-private in the session model.
 */
export async function agentNoteScope(agent: AgentPrincipal): Promise<string | null> {
  if (!agent.ownerUserId) return null;
  return (await agentHasManagerAuthority(agent)) ? null : agent.ownerUserId;
}

/** Prisma `where` fragment limiting boards to the agent's effective access. */
export async function agentBoardWhere(agent: AgentPrincipal) {
  const ids = await agentAccessibleBoardIds(agent);
  return ids === null ? { workspaceId: agent.workspaceId } : { workspaceId: agent.workspaceId, id: { in: ids } };
}

/** Board must be in the agent's workspace AND within its effective access (404 either way — don't leak existence). */
export async function assertAgentBoardAccess(agent: AgentPrincipal, boardId: string) {
  await assertBoardInWorkspace(boardId, agent.workspaceId);
  const ids = await agentAccessibleBoardIds(agent);
  if (ids !== null && !ids.includes(boardId)) throw new HttpError(404, "Board not found");
}

export async function assertAgentTicketAccess(agent: AgentPrincipal, ticketId: string) {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { boardId: true } });
  if (!ticket) throw new HttpError(404, "Ticket not found");
  try {
    await assertAgentBoardAccess(agent, ticket.boardId);
  } catch {
    throw new HttpError(404, "Ticket not found");
  }
}

export async function assertAgentColumnAccess(agent: AgentPrincipal, columnId: string) {
  const col = await db.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
  if (!col) throw new HttpError(404, "Column not found");
  try {
    await assertAgentBoardAccess(agent, col.boardId);
  } catch {
    throw new HttpError(404, "Column not found");
  }
}

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
