import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { broadcast, dispatchWebhook } from "@/lib/webhooks";
import { ticketInclude, serializeTicket, type TicketWithRelations, type UserLite } from "@/lib/serialize";
import { HttpError } from "@/lib/api";
import { onMutation } from "@/lib/snapshots";
import { parseSubStates } from "@/lib/substates";
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

/**
 * Serialize a mutated ticket with its human assignee resolved to a real name.
 * Board loads pass the full workspace-member map to serializeTicket; mutation
 * responses only carry one ticket, so look up just its assignee (otherwise the
 * assignee falls back to the "Someone" placeholder).
 */
async function serializeTicketWithAssignee(t: TicketWithRelations) {
  let usersById: Map<string, UserLite> | undefined;
  if (t.assigneeType === "user" && t.assigneeUserId) {
    const u = await db.user.findUnique({
      where: { id: t.assigneeUserId },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (u) usersById = new Map([[u.id, u]]);
  }
  return serializeTicket(t, usersById);
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
 * Validate an assignee against the board and return the normalized
 * (type, userId, agentId) triple. A human assignee must be an *assignable
 * board member* — a workspace owner/admin (implicit access to every board) or
 * a member the board is shared with via a BoardAccess grant — mirroring
 * `boardAssigneeUsers`, the list every assignee picker offers. An agent
 * assignee is subject to ownership: an owned agent may only be assigned by
 * its owner (or by an agent acting for that same owner); ownerless workspace
 * agents stay assignable by anyone. Throws if the referenced user/agent is
 * foreign, lacks access to this board, or is an agent the actor doesn't own.
 */
async function resolveAssignee(
  board: BoardCtx,
  type: "user" | "agent" | null | undefined,
  userId: string | null | undefined,
  agentId: string | null | undefined,
  actor: Actor,
): Promise<{ assigneeType: "user" | "agent" | null; assigneeUserId: string | null; assigneeAgentId: string | null }> {
  if (type === "user" && userId) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: board.workspaceId, userId },
      select: { role: true },
    });
    if (!member) throw new HttpError(422, "Assignee is not a member of this workspace", "assignee_not_member");
    if (member.role !== "owner" && member.role !== "admin") {
      const grant = await db.boardAccess.findUnique({
        where: { boardId_userId: { boardId: board.id, userId } },
        select: { id: true },
      });
      if (!grant) {
        throw new HttpError(422, "Assignee does not have access to this board", "assignee_no_board_access");
      }
    }
    return { assigneeType: "user", assigneeUserId: userId, assigneeAgentId: null };
  }
  if (type === "agent" && agentId) {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true, ownerUserId: true },
    });
    if (!agent || agent.workspaceId !== board.workspaceId) {
      throw new HttpError(422, "Assignee agent is not in this workspace");
    }
    await assertActorMayAssignAgent(actor, agentId, agent.ownerUserId);
    return { assigneeType: "agent", assigneeUserId: null, assigneeAgentId: agentId };
  }
  // null / unassigned (or a type with no id)
  return { assigneeType: type ?? null, assigneeUserId: null, assigneeAgentId: null };
}

/**
 * Ownership gate for agent assignees. An agent with an owner belongs to that
 * user: only the owner may assign tickets to it — everyone else can still SEE
 * such assignments, they just can't create them. Acting agents are capped the
 * same way: an owner-mapped agent may assign itself or agents of its own
 * owner, while an ownerless (workspace) acting agent — workspace-level
 * automation like a legacy Hermes — may assign any workspace agent. System
 * actors (internal maintenance) are unrestricted.
 */
async function assertActorMayAssignAgent(actor: Actor, agentId: string, ownerUserId: string | null) {
  if (ownerUserId == null || actor.type === "system") return;
  if (actor.type === "user") {
    if (actor.id === ownerUserId) return;
    throw new HttpError(422, "Only this agent's owner can assign tickets to it", "assignee_agent_not_owned");
  }
  // actor.type === "agent"
  if (actor.id === agentId) return; // an agent may always take work itself
  const acting = actor.id
    ? await db.agent.findUnique({ where: { id: actor.id }, select: { ownerUserId: true } })
    : null;
  if (acting && acting.ownerUserId == null) return; // workspace-wide automation
  if (acting?.ownerUserId === ownerUserId) return; // same owner's fleet
  throw new HttpError(422, "Only this agent's owner can assign tickets to it", "assignee_agent_not_owned");
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
  const assignee = await resolveAssignee(board, input.assigneeType, input.assigneeUserId, input.assigneeAgentId, actor);

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

  const serialized = await serializeTicketWithAssignee(ticket);
  await logActivity({
    actor,
    action: "ticket.created",
    boardId: board.id,
    ticketId: ticket.id,
    meta: { title: ticket.title },
  });
  await broadcast(board.workspaceId, "ticket.created", { ticket: serialized }, { actor });
  if (ticket.assigneeType === "agent" && ticket.assigneeAgentId) {
    await dispatchWebhook(ticket.assigneeAgentId, "ticket.assigned", { ticket: serialized }, { actor });
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
    subState: string | null;
    labelIds: string[];
  }>,
  actor: Actor,
) {
  const existing = await loadTicket(ticketId);

  // A column change must go through moveTicket so both columns are renumbered,
  // band grouping is preserved, and the sub-state is validated — a raw columnId
  // write keeps the stale position and the card lands mid-column after reload.
  if (input.columnId !== undefined && input.columnId !== existing.columnId) {
    const { columnId, position: _position, subState, ...rest } = input;
    const moved = await moveTicket(ticketId, columnId, Number.MAX_SAFE_INTEGER, actor, subState);
    if (Object.keys(rest).length === 0) return moved;
    return updateTicket(ticketId, rest, actor);
  }

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
  if (input.subState !== undefined) {
    // Same-column sub-state change: validate against the column's band list so
    // agents/UI can't store orphaned values (mirrors moveTicket's resolution).
    const column = await db.column.findUnique({ where: { id: existing.columnId }, select: { subStates: true } });
    const subStates = parseSubStates(column?.subStates ?? null);
    data.subState = subStates.length
      ? input.subState && subStates.includes(input.subState)
        ? input.subState
        : subStates[0]
      : null;
  }
  if (input.assigneeType !== undefined) {
    const a = await resolveAssignee(board, input.assigneeType, input.assigneeUserId, input.assigneeAgentId, actor);
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
  const serialized = await serializeTicketWithAssignee(updated);

  await logActivity({ actor, action: "ticket.updated", boardId: board.id, ticketId });
  await broadcast(board.workspaceId, "ticket.updated", { ticket: serialized }, { actor });
  if (assigneeChanged && updated.assigneeType === "agent" && updated.assigneeAgentId) {
    await dispatchWebhook(updated.assigneeAgentId, "ticket.assigned", { ticket: serialized }, { actor });
  }
  return serialized;
}

/**
 * After a column's sub-state list changes, snap each ticket whose sub-state is no
 * longer valid onto the first remaining sub-state (or null if the column cleared
 * them), so stored data matches what the board renders — cards are bucketed by
 * their effective sub-state. Safe to call when nothing needs fixing (no-op).
 */
export async function reconcileColumnSubStates(columnId: string) {
  const column = await db.column.findUnique({ where: { id: columnId }, select: { subStates: true } });
  if (!column) return;
  const subStates = parseSubStates(column.subStates);
  const resolve = (s: string | null) => (subStates.length ? (s && subStates.includes(s) ? s : subStates[0]) : null);
  const tickets = await db.ticket.findMany({
    where: { columnId, deletedAt: null },
    select: { id: true, subState: true },
  });
  const fixes = tickets.filter((t) => (resolve(t.subState) ?? null) !== (t.subState ?? null));
  if (fixes.length) {
    await db.$transaction(fixes.map((t) => db.ticket.update({ where: { id: t.id }, data: { subState: resolve(t.subState) } })));
  }
}

export async function moveTicket(
  ticketId: string,
  toColumnId: string,
  position: number,
  actor: Actor,
  subState?: string | null,
) {
  const ticket = await loadTicket(ticketId);
  const board = await boardCtx(ticket.boardId);
  await onMutation(actor, board.workspaceId);
  const fromColumnId = ticket.columnId;

  const targetColumn = await db.column.findUnique({ where: { id: toColumnId } });
  if (!targetColumn || targetColumn.boardId !== board.id) {
    throw new HttpError(422, "Target column not on this board");
  }

  // Resolve the sub-state for the destination column: keep a valid choice,
  // default to the first sub-state, or clear it if the column defines none.
  const subStates = parseSubStates(targetColumn.subStates);
  const resolvedSubState = subStates.length
    ? subState && subStates.includes(subState)
      ? subState
      : subStates[0]
    : null;

  // Rebuild ordering of the target column with the ticket inserted at `position`.
  // Keep the column GROUPED by sub-state band (stable within a band) so a
  // column-wide `position` computed from the grouped board view stays valid and
  // the stored order can never silently diverge from what the client renders.
  const bandIndex = (sub: string | null) => {
    if (!subStates.length) return 0;
    const i = sub ? subStates.indexOf(sub) : -1;
    return i === -1 ? 0 : i;
  };
  const targetRows = await db.ticket.findMany({
    where: { columnId: toColumnId, deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true, subState: true, position: true },
  });
  const oldPos = new Map(targetRows.map((t) => [t.id, t.position]));
  const targetIds = targetRows
    .filter((t) => t.id !== ticketId)
    .map((t, i) => ({ id: t.id, band: bandIndex(t.subState), ord: i }))
    .sort((a, b) => a.band - b.band || a.ord - b.ord)
    .map((t) => t.id);
  const clamped = Math.max(0, Math.min(position, targetIds.length));
  targetIds.splice(clamped, 0, ticketId);

  // Only touch rows that actually change — a blanket renumber would bump every
  // ticket's updatedAt, which My Day uses to group completions by day.
  await db.$transaction(
    targetIds
      .map((id, idx) => ({ id, idx }))
      .filter(({ id, idx }) => id === ticketId || oldPos.get(id) !== idx)
      .map(({ id, idx }) =>
        db.ticket.update({
          where: { id },
          data: { columnId: toColumnId, position: idx, ...(id === ticketId ? { subState: resolvedSubState } : {}) },
        }),
      ),
  );

  // Reindex the source column if the ticket actually changed columns.
  if (fromColumnId !== toColumnId) {
    const sourceRows = await db.ticket.findMany({
      where: { columnId: fromColumnId, deletedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    await db.$transaction(
      sourceRows
        .map((t, idx) => ({ t, idx }))
        .filter(({ t, idx }) => t.position !== idx)
        .map(({ t, idx }) => db.ticket.update({ where: { id: t.id }, data: { position: idx } })),
    );
  }

  const updated = await loadTicket(ticketId);
  const serialized = await serializeTicketWithAssignee(updated);

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
  }, { actor });
  return serialized;
}

export async function moveTicketToDone(ticketId: string, actor: Actor) {
  const ticket = await loadTicket(ticketId);
  const doneColumn = await db.column.findFirst({
    where: { boardId: ticket.boardId, isDone: true },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (!doneColumn) throw new HttpError(422, "No done column is configured for this board.");
  const last = await db.ticket.findFirst({
    where: { columnId: doneColumn.id, deletedAt: null, id: { not: ticketId } },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return moveTicket(ticketId, doneColumn.id, (last?.position ?? -1) + 1, actor, null);
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
  }, { actor });
  return comment;
}

/** Soft-delete: move to "Recently deleted" (restorable for 30 days, then purged). */
export async function deleteTicket(ticketId: string, actor: Actor) {
  const ticket = await loadTicket(ticketId);
  const board = await boardCtx(ticket.boardId);
  await onMutation(actor, board.workspaceId);
  await db.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } });
  await logActivity({
    actor,
    action: "ticket.deleted",
    boardId: board.id,
    meta: { title: ticket.title },
  });
  await broadcast(board.workspaceId, "ticket.updated", { deletedId: ticketId }, { actor });
}
