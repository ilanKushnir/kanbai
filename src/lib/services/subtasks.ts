import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { broadcast } from "@/lib/webhooks";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
import { onMutation } from "@/lib/snapshots";
import type { Actor } from "./tickets";

/**
 * Subtasks — a persistent, ordered checklist inside a ticket. Every mutation
 * returns the full serialized ticket (subtasks included) so callers can swap
 * their ticket state in one go, and broadcasts `ticket.updated` so other
 * clients/webhooks stay in sync.
 */

async function ticketCtx(ticketId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, boardId: true, board: { select: { workspaceId: true } } },
  });
  if (!ticket) throw new HttpError(404, "Ticket not found");
  return { id: ticket.id, boardId: ticket.boardId, workspaceId: ticket.board.workspaceId };
}

/** The subtask must belong to the ticket named in the route (404 otherwise). */
async function loadSubtaskOf(ticketId: string, subtaskId: string) {
  const subtask = await db.subtask.findUnique({ where: { id: subtaskId } });
  if (!subtask || subtask.ticketId !== ticketId) throw new HttpError(404, "Subtask not found");
  return subtask;
}

async function serializedTicket(ticketId: string) {
  const t = await db.ticket.findUnique({ where: { id: ticketId }, include: ticketInclude });
  if (!t) throw new HttpError(404, "Ticket not found");
  return serializeTicket(t);
}

async function finish(action: string, ticket: { id: string; boardId: string; workspaceId: string }, actor: Actor, meta?: Record<string, unknown>) {
  const serialized = await serializedTicket(ticket.id);
  await logActivity({ actor, action, boardId: ticket.boardId, ticketId: ticket.id, meta });
  await broadcast(ticket.workspaceId, "ticket.updated", { ticket: serialized }, { actor });
  return serialized;
}

export async function createSubtask(ticketId: string, title: string, actor: Actor) {
  const ticket = await ticketCtx(ticketId);
  await onMutation(actor, ticket.workspaceId);
  const last = await db.subtask.findFirst({
    where: { ticketId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await db.subtask.create({
    data: {
      ticketId,
      title,
      position: (last?.position ?? -1) + 1,
      createdByType: actor.type === "agent" ? "agent" : "user",
      createdById: actor.id ?? null,
    },
  });
  return finish("subtask.created", ticket, actor, { title });
}

export async function updateSubtask(
  ticketId: string,
  subtaskId: string,
  input: { title?: string; completed?: boolean },
  actor: Actor,
) {
  const ticket = await ticketCtx(ticketId);
  const subtask = await loadSubtaskOf(ticketId, subtaskId);
  await onMutation(actor, ticket.workspaceId);
  await db.subtask.update({
    where: { id: subtaskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
    },
  });
  const action =
    input.completed === undefined ? "subtask.updated" : input.completed ? "subtask.completed" : "subtask.reopened";
  return finish(action, ticket, actor, { title: input.title ?? subtask.title });
}

export async function deleteSubtask(ticketId: string, subtaskId: string, actor: Actor) {
  const ticket = await ticketCtx(ticketId);
  const subtask = await loadSubtaskOf(ticketId, subtaskId);
  await onMutation(actor, ticket.workspaceId);
  await db.subtask.delete({ where: { id: subtaskId } });
  // Close the position gap so orderedIds-based reorders stay dense.
  const rest = await db.subtask.findMany({
    where: { ticketId },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });
  await db.$transaction(
    rest
      .map((s, idx) => ({ s, idx }))
      .filter(({ s, idx }) => s.position !== idx)
      .map(({ s, idx }) => db.subtask.update({ where: { id: s.id }, data: { position: idx } })),
  );
  return finish("subtask.deleted", ticket, actor, { title: subtask.title });
}

/**
 * Reorder the ticket's subtasks to match `orderedIds`. Ids must be exactly the
 * ticket's current subtasks (any order) — a stale or partial list is a 422 so
 * two racing clients can't silently drop items.
 */
export async function reorderSubtasks(ticketId: string, orderedIds: string[], actor: Actor) {
  const ticket = await ticketCtx(ticketId);
  const current = await db.subtask.findMany({ where: { ticketId }, select: { id: true } });
  const currentIds = new Set(current.map((s) => s.id));
  if (orderedIds.length !== currentIds.size || orderedIds.some((id) => !currentIds.has(id))) {
    throw new HttpError(422, "orderedIds must contain exactly this ticket's subtask ids");
  }
  await onMutation(actor, ticket.workspaceId);
  await db.$transaction(
    orderedIds.map((id, position) => db.subtask.update({ where: { id }, data: { position } })),
  );
  return finish("subtask.reordered", ticket, actor);
}
