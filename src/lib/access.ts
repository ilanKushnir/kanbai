import type { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { HttpError } from "./api";

// Guards for the AGENT API. Agents without an owning user see everything in
// their workspace. Agents with `ownerUserId` act for that person, so they
// reach exactly the boards the owner can open in the app — in EVERY workspace
// the owner belongs to: all boards where the owner is a manager, and the
// boards shared with them (BoardAccess) elsewhere. That is what lets a
// person's agent file work on a board someone shared with them.

type AgentPrincipal = { workspaceId: string; ownerUserId?: string | null };

/**
 * The board ids an agent may act on, or null meaning "every board in its
 * workspace" (an agent with no owner). Kept for callers that need ids; the
 * owner's boards may span several workspaces.
 */
export async function agentAccessibleBoardIds(agent: AgentPrincipal): Promise<string[] | null> {
  if (!agent.ownerUserId) return null;
  const boards = await db.board.findMany({ where: await agentBoardWhere(agent), select: { id: true } });
  return boards.map((b) => b.id);
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
export async function agentBoardWhere(agent: AgentPrincipal): Promise<Prisma.BoardWhereInput> {
  if (!agent.ownerUserId) return { workspaceId: agent.workspaceId };
  const ownerId = agent.ownerUserId;
  const memberships = await db.workspaceMember.findMany({ where: { userId: ownerId }, select: { workspaceId: true, role: true } });
  // An owner who left the agent's workspace switches it off entirely.
  if (!memberships.some((m) => m.workspaceId === agent.workspaceId)) return { id: { in: [] } };
  return {
    OR: memberships.map((m) =>
      m.role === "owner" || m.role === "admin"
        ? { workspaceId: m.workspaceId }
        : { workspaceId: m.workspaceId, access: { some: { userId: ownerId } } },
    ),
  };
}

/** Board must be within the agent's effective access (404 otherwise — don't leak existence). */
export async function assertAgentBoardAccess(agent: AgentPrincipal, boardId: string) {
  const hit = await db.board.findFirst({ where: { AND: [{ id: boardId }, await agentBoardWhere(agent)] }, select: { id: true } });
  if (!hit) throw new HttpError(404, "Board not found");
}

/** The workspaces whose people an agent's boards can involve (for resolving names). */
export async function agentWorkspaceIds(agent: AgentPrincipal): Promise<string[]> {
  if (!agent.ownerUserId) return [agent.workspaceId];
  const memberships = await db.workspaceMember.findMany({ where: { userId: agent.ownerUserId }, select: { workspaceId: true } });
  return [...new Set([agent.workspaceId, ...memberships.map((m) => m.workspaceId)])];
}

/** The workspace a board lives in — an agent's shared boards can sit in someone else's. */
export async function boardWorkspaceId(boardId: string): Promise<string> {
  const board = await db.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } });
  if (!board) throw new HttpError(404, "Board not found");
  return board.workspaceId;
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
