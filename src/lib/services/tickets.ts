import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { broadcast, dispatchWebhook } from "@/lib/webhooks";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
import { HttpError } from "@/lib/api";

export type Actor = { type: "user" | "agent" | "system"; id?: string | null; name: string };

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
  },
  actor: Actor,
) {
  const board = await boardCtx(input.boardId);

  let columnId = input.columnId;
  if (!columnId) {
    const first = await db.column.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "asc" },
    });
    if (!first) throw new HttpError(422, "Board has no columns");
    columnId = first.id;
  }

  const last = await db.ticket.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const ticket = await db.ticket.create({
    include: ticketInclude,
    data: {
      boardId: board.id,
      columnId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "medium",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      position: (last?.position ?? -1) + 1,
      assigneeType: input.assigneeType ?? null,
      assigneeUserId: input.assigneeType === "user" ? input.assigneeUserId ?? null : null,
      assigneeAgentId: input.assigneeType === "agent" ? input.assigneeAgentId ?? null : null,
      createdByType: actor.type === "agent" ? "agent" : "user",
      // createdById has a FK to User, so only set it for human actors.
      createdById: actor.type === "user" ? actor.id ?? null : null,
      labels: input.labelIds?.length
        ? { create: input.labelIds.map((labelId) => ({ labelId })) }
        : undefined,
    },
  });

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

  const assigneeChanged =
    input.assigneeType !== undefined &&
    (input.assigneeType !== existing.assigneeType ||
      input.assigneeAgentId !== existing.assigneeAgentId);

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.columnId !== undefined) data.columnId = input.columnId;
  if (input.position !== undefined) data.position = input.position;
  if (input.assigneeType !== undefined) {
    data.assigneeType = input.assigneeType;
    data.assigneeUserId = input.assigneeType === "user" ? input.assigneeUserId ?? null : null;
    data.assigneeAgentId = input.assigneeType === "agent" ? input.assigneeAgentId ?? null : null;
  }

  if (input.labelIds) {
    await db.ticketLabel.deleteMany({ where: { ticketId } });
    if (input.labelIds.length) {
      await db.ticketLabel.createMany({
        data: input.labelIds.map((labelId) => ({ ticketId, labelId })),
      });
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
  await db.ticket.delete({ where: { id: ticketId } });
  await logActivity({
    actor,
    action: "ticket.deleted",
    boardId: board.id,
    meta: { title: ticket.title },
  });
  await broadcast(board.workspaceId, "ticket.updated", { deletedId: ticketId });
}
