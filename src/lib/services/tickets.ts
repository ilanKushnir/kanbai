import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { broadcast, dispatchWebhook } from "@/lib/webhooks";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
import { HttpError } from "@/lib/api";
import { onMutation } from "@/lib/snapshots";
import { toRichHtml } from "@/lib/sanitize";

export type Actor = { type: "user" | "agent" | "system"; id?: string | null; name: string };

/** True for a Prisma unique-constraint violation on the (boardId, number) index. */
function isUniqueNumberError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002" &&
    JSON.stringify((e as { meta?: unknown }).meta ?? "").includes("number")
  );
}

async function loadTicket(id: string) {
  const t = await db.ticket.findUnique({ include: ticketInclude, where: { id } });
  if (!t) throw new HttpError(404, "Ticket not found");
  return t;
}

async function boardCtx(boardId: string) {
  const board = await db.board.findUnique({
    where: { id: boardId },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!board) throw new HttpError(404, "Board not found");
  return board;
}

type BoardCtx = { id: string; workspaceId: string };

/** A column referenced on a ticket must live on the same board. */
async function assertColumnOnBoard(columnId: string, board: BoardCtx) {
  const col = await db.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
  if (!col || col.boardId !== board.id) throw new HttpError(422, "Column is not on this board");
}

/** Drop any label ids that don't belong to this board (prevents cross-board/tenant labels). */
async function boardLabelIds(labelIds: string[], board: BoardCtx): Promise<string[]> {
  if (!labelIds.length) return [];
  const rows = await db.label.findMany({
    where: { id: { in: labelIds }, boardId: board.id },
    select: { id: true },
  });
  return rows.map((l) => l.id);
}

/**
 * Validate an assignee against the board's workspace and return the normalized
 * (type, userId, agentId) triple. Throws if the referenced user/agent is foreign.
 */
async function resolveAssignee(
  board: BoardCtx,
  type: "user" | "agent" | null | undefined,
  userId: string | null | undefined,
  agentId: string | null | undefined,
): Promise<{ assigneeType: "user" | "agent" | null; assigneeUserId: string | null; assigneeAgentId: string | null }> {
  if (type === "user" && userId) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: board.workspaceId, userId },
      select: { id: true },
    });
    if (!member) throw new HttpError(422, "Assignee is not a member of this workspace");
    return { assigneeType: "user", assigneeUserId: userId, assigneeAgentId: null };
  }
  if (type === "agent" && agentId) {
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
    if (!agent || agent.workspaceId !== board.workspaceId) {
      throw new HttpError(422, "Assignee agent is not in this workspace");
    }
    return { assigneeType: "agent", assigneeUserId: null, assigneeAgentId: agentId };
  }
  // null / unassigned (or a type with no id)
  return { assigneeType: type ?? null, assigneeUserId: null, assigneeAgentId: null };
}

export async function createTicket(
  input: {
    boardId: string;
    columnId?: string;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
    assigneeType?: "user" | "agent" | null;
    assigneeUserId?: string | null;
    assigneeAgentId?: string | null;
    labelIds?: string[];
    number?: number; // explicit number (migration); otherwise auto-assigned
    createdAt?: string | null; // preserve original creation time on migration
  },
  actor: Actor,
) {
  const board = await boardCtx(input.boardId);
  await onMutation(actor, board.workspaceId);

  let columnId = input.columnId;
  if (columnId) {
    await assertColumnOnBoard(columnId, board);
  } else {
    const first = await db.column.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "asc" },
    });
    if (!first) throw new HttpError(422, "Board has no columns");
    columnId = first.id;
  }

  const labelIds = await boardLabelIds(input.labelIds ?? [], board);
  const assignee = await resolveAssignee(board, input.assigneeType, input.assigneeUserId, input.assigneeAgentId);

  const last = await db.ticket.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const baseData = {
    boardId: board.id,
    columnId,
    title: input.title,
    description: toRichHtml(input.description),
    priority: input.priority ?? "medium",
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
    position: (last?.position ?? -1) + 1,
    assigneeType: assignee.assigneeType,
    assigneeUserId: assignee.assigneeUserId,
    assigneeAgentId: assignee.assigneeAgentId,
    createdByType: actor.type === "agent" ? "agent" : "user",
    // createdById has a FK to User, so only set it for human actors.
    createdById: actor.type === "user" ? actor.id ?? null : null,
    labels: labelIds.length ? { create: labelIds.map((labelId) => ({ labelId })) } : undefined,
  };

  // Per-board sequential reference number (#12). The (boardId, number) unique
  // index guards against duplicates; retry the auto path on a race. An explicit
  // number (migration) that collides surfaces as a clear 409.
  const ticket = await (async () => {
    if (input.number != null) {
      try {
        return await db.ticket.create({ include: ticketInclude, data: { ...baseData, number: input.number } });
      } catch (e) {
        if (isUniqueNumberError(e)) throw new HttpError(409, `Ticket #${input.number} already exists on this board`);
        throw e;
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const max = await db.ticket.aggregate({ where: { boardId: board.id }, _max: { number: true } });
      const number = (max._max.number ?? 0) + 1;
      try {
        return await db.ticket.create({ include: ticketInclude, data: { ...baseData, number } });
      } catch (e) {
        if (isUniqueNumberError(e)) continue; // raced another create; recompute
        throw e;
      }
    }
    throw new HttpError(409, "Could not allocate a ticket number; please retry");
  })();

  const serialized = serializeTicket(ticket);
  await logActivity({
    actor,
    action: "ticket.created",
    boardId: board.id,
    ticketId: ticket.id,
    meta: { title: ticket.title },
  });
  await broadcast(board.workspaceId, "ticket.created", { ticket: serialized });
  if (ticket.assigneeType === "agent" && ticket.assigneeAgentId) {
    await dispatchWebhook(ticket.assigneeAgentId, "ticket.assigned", { ticket: serialized });
  }
  return serialized;
}

export async function updateTicket(
  ticketId: string,
  input: Partial<{
    title: string;
    description: string;
    priority: string;
    dueDate: string | null;
    assigneeType: "user" | "agent" | null;
    assigneeUserId: string | null;
    assigneeAgentId: string | null;
    columnId: string;
    position: number;
    labelIds: string[];
  }>,
  actor: Actor,
) {
  const existing = await loadTicket(ticketId);
  const board = await boardCtx(existing.boardId);
  await onMutation(actor, board.workspaceId);

  const assigneeChanged =
    input.assigneeType !== undefined &&
    (input.assigneeType !== existing.assigneeType ||
      input.assigneeAgentId !== existing.assigneeAgentId);

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = toRichHtml(input.description);
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.columnId !== undefined) {
    await assertColumnOnBoard(input.columnId, board); // can't move to a foreign board's column
    data.columnId = input.columnId;
  }
  if (input.position !== undefined) data.position = input.position;
  if (input.assigneeType !== undefined) {
    const a = await resolveAssignee(board, input.assigneeType, input.assigneeUserId, input.assigneeAgentId);
    data.assigneeType = a.assigneeType;
    data.assigneeUserId = a.assigneeUserId;
    data.assigneeAgentId = a.assigneeAgentId;
  }

  if (input.labelIds) {
    const labelIds = await boardLabelIds(input.labelIds, board); // only this board's labels
    await db.ticketLabel.deleteMany({ where: { ticketId } });
    if (labelIds.length) {
      await db.ticketLabel.createMany({ data: labelIds.map((labelId) => ({ ticketId, labelId })) });
    }
  }

  const updated = await db.ticket.update({ where: { id: ticketId }, data, include: ticketInclude });
  const serialized = serializeTicket(updated);

  await logActivity({ actor, action: "ticket.updated", boardId: board.id, ticketId });
  await broadcast(board.workspaceId, "ticket.updated", { ticket: serialized });
  if (assigneeChanged && updated.assigneeType === "agent" && updated.assigneeAgentId) {
    await dispatchWebhook(updated.assigneeAgentId, "ticket.assigned", { ticket: serialized });
  }
  return serialized;
}

export async function moveTicket(
  ticketId: string,
  toColumnId: string,
  position: number,
  actor: Actor,
) {
  const ticket = await loadTicket(ticketId);
  const board = await boardCtx(ticket.boardId);
  await onMutation(actor, board.workspaceId);
  const fromColumnId = ticket.columnId;

  const targetColumn = await db.column.findUnique({ where: { id: toColumnId } });
  if (!targetColumn || targetColumn.boardId !== board.id) {
    throw new HttpError(422, "Target column not on this board");
  }

  // Rebuild ordering of the target column with the ticket inserted at `position`.
  const targetIds = (
    await db.ticket.findMany({
      where: { columnId: toColumnId },
      orderBy: { position: "asc" },
      select: { id: true },
    })
  )
    .map((t) => t.id)
    .filter((id) => id !== ticketId);
  const clamped = Math.max(0, Math.min(position, targetIds.length));
  targetIds.splice(clamped, 0, ticketId);

  await db.$transaction([
    ...targetIds.map((id, idx) =>
      db.ticket.update({ where: { id }, data: { columnId: toColumnId, position: idx } }),
    ),
  ]);

  // Reindex the source column if the ticket actually changed columns.
  if (fromColumnId !== toColumnId) {
    const sourceIds = await db.ticket.findMany({
      where: { columnId: fromColumnId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await db.$transaction(
      sourceIds.map((t, idx) => db.ticket.update({ where: { id: t.id }, data: { position: idx } })),
    );
  }

  const updated = await loadTicket(ticketId);
  const serialized = serializeTicket(updated);

  await logActivity({
    actor,
    action: "ticket.moved",
    boardId: board.id,
    ticketId,
    meta: { to: targetColumn.name },
  });
  await broadcast(board.workspaceId, "ticket.moved", {
    ticket: serialized,
    from: fromColumnId,
    to: toColumnId,
  });
  return serialized;
}

export async function addComment(ticketId: string, body: string, actor: Actor) {
  const ticket = await loadTicket(ticketId);
  const board = await boardCtx(ticket.boardId);
  await onMutation(actor, board.workspaceId);

  const comment = await db.comment.create({
    data: {
      ticketId,
      authorType: actor.type === "agent" ? "agent" : "user",
      authorId: actor.id ?? null,
      authorName: actor.name,
      body,
    },
  });

  await logActivity({ actor, action: "comment.created", boardId: board.id, ticketId });
  await broadcast(board.workspaceId, "comment.created", {
    ticketId,
    comment: {
      id: comment.id,
      authorType: comment.authorType,
      authorName: comment.authorName,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    },
  });
  return comment;
}

export async function deleteTicket(ticketId: string, actor: Actor) {
  const ticket = await loadTicket(ticketId);
  const board = await boardCtx(ticket.boardId);
  await onMutation(actor, board.workspaceId);
  await db.ticket.delete({ where: { id: ticketId } });
  await logActivity({
    actor,
    action: "ticket.deleted",
    boardId: board.id,
    meta: { title: ticket.title },
  });
  await broadcast(board.workspaceId, "ticket.updated", { deletedId: ticketId });
}
