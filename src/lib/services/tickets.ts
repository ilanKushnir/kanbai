import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { ticketInclude, serializeTicket, type TicketWithRelations, type UserLite } from "@/lib/serialize";
import { HttpError } from "@/lib/api";
import { onMutation } from "@/lib/snapshots";
import { parseSubStates } from "@/lib/substates";
import { toRichHtml } from "@/lib/sanitize";
import { resolveColumnStage, type ColumnStage } from "@/lib/column-stage";
import { LABEL_COLORS } from "@/lib/constants";

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
      select: { id: true, name: true, avatarUrl: true, avatarColor: true },
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
  const col = await db.column.findUnique({ where: { id: columnId }, select: { boardId: true, isDone: true, subStates: true } });
  if (!col || col.boardId !== board.id) throw new HttpError(422, "Column is not on this board");
  return col;
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

function labelColorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(h) % LABEL_COLORS.length];
}

/**
 * Resolve label NAMES on a board to ids — case-insensitive match, and any
 * missing name is created on the board with a stable, name-derived color.
 * The one helper behind every `labelNames` input (create, patch, promote, sort).
 */
export async function ensureLabelsByName(boardId: string, names: string[] | undefined | null): Promise<string[]> {
  const wanted = [...new Set((names ?? []).map((n) => n.trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const existing = await db.label.findMany({ where: { boardId } });
  const ids: string[] = [];
  for (const name of wanted) {
    const match = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (match) {
      ids.push(match.id);
      continue;
    }
    const createdLabel = await db.label.create({ data: { boardId, name, color: labelColorFor(name) } });
    existing.push(createdLabel);
    ids.push(createdLabel.id);
  }
  return ids;
}

/** How a caller may address a column: by id, by (case-insensitive) name, or by semantic stage. */
export type ColumnRef = {
  columnId?: string | null;
  column?: string | null;
  columnName?: string | null;
  stage?: ColumnStage | string | null;
};

/**
 * Resolve a {@link ColumnRef} to a column id on `boardId`. Precedence:
 * columnId → column/columnName (case-insensitive) → stage (first column whose
 * effective stage matches, by position). Returns undefined when nothing was
 * given so callers can apply their own default (first column). 422 on a miss.
 */
export async function resolveColumnRef(boardId: string, ref: ColumnRef | undefined | null): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.columnId) return ref.columnId;
  const name = (ref.column ?? ref.columnName)?.trim();
  const stage = ref.stage?.trim().toLowerCase();
  if (!name && !stage) return undefined;
  const cols = await db.column.findMany({ where: { boardId }, orderBy: { position: "asc" } });
  if (name) {
    const hit = cols.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (!hit) {
      throw new HttpError(
        422,
        `No column named "${name}" on this board (have: ${cols.map((c) => c.name).join(", ")})`,
        "column_not_found",
      );
    }
    return hit.id;
  }
  const hit = cols.find((c) => resolveColumnStage(c.stage, c.name, c.isDone) === stage);
  if (!hit) throw new HttpError(422, `No column with stage "${stage}" on this board`, "column_not_found");
  return hit.id;
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
async function assertUserAssignable(board: BoardCtx, userId: string) {
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
}

/**
 * Normalize the raw assignee inputs into (type, userIds) so the legacy single
 * `assigneeUserId` and the multi `assigneeUserIds` behave identically: a
 * non-empty list implies "user" when no type was sent, and each shape maps to
 * one ordered, de-duplicated list (first entry = primary assignee).
 */
function normalizeAssigneeInput(input: {
  assigneeType?: "user" | "agent" | null;
  assigneeUserId?: string | null;
  assigneeUserIds?: string[] | null;
  assigneeAgentId?: string | null;
}): { type: "user" | "agent" | null | undefined; userIds: string[] } {
  const list = input.assigneeUserIds?.length
    ? input.assigneeUserIds
    : input.assigneeUserId
      ? [input.assigneeUserId]
      : [];
  const userIds = [...new Set(list)];
  const type =
    input.assigneeType !== undefined
      ? input.assigneeType
      : input.assigneeUserIds !== undefined
        ? userIds.length
          ? ("user" as const)
          : null
        : undefined;
  return { type, userIds };
}

async function resolveAssignee(
  board: BoardCtx,
  type: "user" | "agent" | null | undefined,
  userIds: string[],
  agentId: string | null | undefined,
  actor: Actor,
): Promise<{
  assigneeType: "user" | "agent" | null;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  assigneeUserIds: string[];
}> {
  if (type === "user" && userIds.length) {
    for (const userId of userIds) await assertUserAssignable(board, userId);
    return { assigneeType: "user", assigneeUserId: userIds[0], assigneeAgentId: null, assigneeUserIds: userIds };
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
    return { assigneeType: "agent", assigneeUserId: null, assigneeAgentId: agentId, assigneeUserIds: [] };
  }
  // null / unassigned (or a type with no id)
  return { assigneeType: type ?? null, assigneeUserId: null, assigneeAgentId: null, assigneeUserIds: [] };
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
    /** Column by name (case-insensitive) — alias of columnName. */
    column?: string;
    columnName?: string;
    /** Column by semantic stage (intake | backlog | active | done). */
    stage?: ColumnStage | string;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
    assigneeType?: "user" | "agent" | null;
    assigneeUserId?: string | null;
    assigneeUserIds?: string[] | null;
    assigneeAgentId?: string | null;
    labelIds?: string[];
    /** Labels by name — missing ones are created on the board. Merged with labelIds. */
    labelNames?: string[];
    number?: number; // explicit number (migration); otherwise auto-assigned
    createdAt?: string | null; // preserve original creation time on migration
  },
  actor: Actor,
) {
  const board = await boardCtx(input.boardId);
  await onMutation(actor, board.workspaceId);

  let columnId = await resolveColumnRef(board.id, input);
  let columnIsDone = false;
  let columnSubStates: string[] = [];
  if (columnId) {
    const col = await assertColumnOnBoard(columnId, board);
    columnIsDone = col.isDone;
    columnSubStates = parseSubStates(col.subStates);
  } else {
    const first = await db.column.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "asc" },
    });
    if (!first) throw new HttpError(422, "Board has no columns");
    columnId = first.id;
    columnIsDone = first.isDone;
    columnSubStates = parseSubStates(first.subStates);
  }

  const labelIds = [
    ...new Set([
      ...(await boardLabelIds(input.labelIds ?? [], board)),
      ...(await ensureLabelsByName(board.id, input.labelNames)),
    ]),
  ];
  // A human creating a ticket takes it by default: with no assignee input at
  // all, the ticket lands on the creator's own plate. An explicit
  // `assigneeType: null` still means "unassigned", and agent/system actors
  // keep explicit-only assignment (v1 agents must never inherit a human).
  const defaultToActor =
    actor.type === "user" &&
    actor.id != null &&
    input.assigneeType === undefined &&
    input.assigneeUserId === undefined &&
    input.assigneeUserIds === undefined &&
    input.assigneeAgentId === undefined;
  const normalized = normalizeAssigneeInput(input);
  const assignee = defaultToActor
    ? await resolveAssignee(board, "user", [actor.id!], null, actor)
    : await resolveAssignee(board, normalized.type, normalized.userIds, input.assigneeAgentId, actor);

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
    // A column with sub-states files new cards into its first band (mirrors moveTicket).
    subState: columnSubStates[0] ?? null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
    position: (last?.position ?? -1) + 1,
    // Landing straight in a done column counts as completed (migrations).
    completedAt: columnIsDone ? new Date() : null,
    assigneeType: assignee.assigneeType,
    assigneeUserId: assignee.assigneeUserId,
    assigneeAgentId: assignee.assigneeAgentId,
    assignees: assignee.assigneeUserIds.length
      ? { create: assignee.assigneeUserIds.map((userId, position) => ({ userId, position })) }
      : undefined,
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
    meta: { title: ticket.title, column: serialized.column ?? null },
  });
  if (columnIsDone) {
    await logActivity({ actor, action: "ticket.done", boardId: board.id, ticketId: ticket.id, meta: { title: ticket.title } });
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
    assigneeUserIds: string[] | null;
    assigneeAgentId: string | null;
    columnId: string;
    column: string;
    columnName: string;
    stage: ColumnStage | string;
    position: number;
    subState: string | null;
    labelIds: string[];
    /** Replaces the full label set by name (missing names auto-created on the board). */
    labelNames: string[];
  }>,
  actor: Actor,
) {
  const existing = await loadTicket(ticketId);

  // Column aliases (name / stage) resolve to an id up front.
  if (input.columnId === undefined && (input.column || input.columnName || input.stage)) {
    const { column, columnName, stage, ...rest } = input;
    const columnId = await resolveColumnRef(existing.boardId, { column, columnName, stage });
    return updateTicket(ticketId, { ...rest, ...(columnId ? { columnId } : {}) }, actor);
  }

  // A column change must go through moveTicket so both columns are renumbered,
  // band grouping is preserved, and the sub-state is validated — a raw columnId
  // write keeps the stale position and the card lands mid-column after reload.
  if (input.columnId !== undefined && input.columnId !== existing.columnId) {
    const { columnId, position: _position, subState, column: _c, columnName: _cn, stage: _st, ...rest } = input;
    void _position;
    void _c;
    void _cn;
    void _st;
    const moved = await moveTicket(ticketId, columnId, Number.MAX_SAFE_INTEGER, actor, subState);
    if (Object.keys(rest).length === 0) return moved;
    return updateTicket(ticketId, rest, actor);
  }

  const board = await boardCtx(existing.boardId);
  await onMutation(actor, board.workspaceId);

  // A multi-assign write (assigneeUserIds) implies an assignee change even
  // when no assigneeType was sent alongside it.
  const assigneeInputPresent = input.assigneeType !== undefined || input.assigneeUserIds !== undefined;
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
  if (assigneeInputPresent) {
    const normalized = normalizeAssigneeInput(input);
    const a = await resolveAssignee(board, normalized.type, normalized.userIds, input.assigneeAgentId, actor);
    data.assigneeType = a.assigneeType;
    data.assigneeUserId = a.assigneeUserId;
    data.assigneeAgentId = a.assigneeAgentId;
    // Replace the multi-assign rows wholesale — the list IS the new state.
    data.assignees = {
      deleteMany: {},
      create: a.assigneeUserIds.map((userId, position) => ({ userId, position })),
    };
  }

  if (input.labelIds || input.labelNames) {
    // The combined set IS the new state: ids (this board's only) + names (find-or-create).
    const labelIds = [
      ...new Set([
        ...(await boardLabelIds(input.labelIds ?? [], board)),
        ...(await ensureLabelsByName(board.id, input.labelNames)),
      ]),
    ];
    await db.ticketLabel.deleteMany({ where: { ticketId } });
    if (labelIds.length) {
      await db.ticketLabel.createMany({ data: labelIds.map((labelId) => ({ ticketId, labelId })) });
    }
  }

  const updated = await db.ticket.update({ where: { id: ticketId }, data, include: ticketInclude });
  const serialized = await serializeTicketWithAssignee(updated);

  const fields = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
  await logActivity({
    actor,
    action: "ticket.updated",
    boardId: board.id,
    ticketId,
    meta: { title: updated.title, fields, ...(assigneeChanged ? { assigneeChanged: true } : {}) },
  });
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

/**
 * Move a ticket to another column (or reorder within one). `position` is the
 * index within the target column; omit it (or pass Number.MAX_SAFE_INTEGER) to
 * append at the end.
 */
export async function moveTicket(
  ticketId: string,
  toColumnId: string,
  position: number | null | undefined,
  actor: Actor,
  subState?: string | null,
) {
  const ticket = await loadTicket(ticketId);
  const board = await boardCtx(ticket.boardId);
  await onMutation(actor, board.workspaceId);
  const fromColumnId = ticket.columnId;
  const fromColumn = await db.column.findUnique({ where: { id: fromColumnId }, select: { name: true, isDone: true } });
  if (position == null) position = Number.MAX_SAFE_INTEGER;

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
          data: {
            columnId: toColumnId,
            position: idx,
            ...(id === ticketId
              ? {
                  subState: resolvedSubState,
                  // Entering a done column stamps completion (kept if already
                  // done, e.g. reordering); leaving one clears it so a
                  // reopened ticket can go overdue again.
                  completedAt: targetColumn.isDone ? ticket.completedAt ?? new Date() : null,
                }
              : {}),
          },
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

  const becameDone = targetColumn.isDone && !(fromColumn?.isDone ?? false);
  const reopened = !targetColumn.isDone && (fromColumn?.isDone ?? false);
  await logActivity({
    actor,
    // Landing in a done column is its own event ("ticket.done") so feeds and
    // agents can tell completion apart from a plain reorder/move.
    action: becameDone ? "ticket.done" : reopened ? "ticket.reopened" : "ticket.moved",
    boardId: board.id,
    ticketId,
    meta: {
      title: ticket.title,
      from: fromColumn?.name ?? null,
      to: targetColumn.name,
      toColumn: targetColumn.name,
      toColumnId,
      sameColumn: fromColumnId === toColumnId,
    },
  });
  return serialized;
}

/** The board's done column (first isDone column by position), or null. */
export async function boardDoneColumnId(boardId: string): Promise<string | null> {
  const col = await db.column.findFirst({ where: { boardId, isDone: true }, orderBy: { position: "asc" }, select: { id: true } });
  return col?.id ?? null;
}

export async function moveTicketToDone(ticketId: string, actor: Actor) {
  const ticket = await loadTicket(ticketId);
  const doneColumnId = await boardDoneColumnId(ticket.boardId);
  if (!doneColumnId) throw new HttpError(422, "No done column is configured for this board.");
  return moveTicket(ticketId, doneColumnId, Number.MAX_SAFE_INTEGER, actor, null);
}

/** Complete a ticket: move it to its board's done column (= moveTicketToDone). */
export const completeTicket = moveTicketToDone;

/**
 * Reopen a completed ticket by moving it back into `columnId` (end of that
 * column). When `columnId` is omitted, the first non-done column is used.
 */
export async function uncompleteTicket(ticketId: string, columnId: string | null | undefined, actor: Actor) {
  const ticket = await loadTicket(ticketId);
  let target = columnId ?? null;
  if (!target) {
    const first = await db.column.findFirst({
      where: { boardId: ticket.boardId, isDone: false },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!first) throw new HttpError(422, "This board has no open column to reopen into.");
    target = first.id;
  }
  return moveTicket(ticketId, target, Number.MAX_SAFE_INTEGER, actor, null);
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

  await logActivity({
    actor,
    action: "comment.created",
    boardId: board.id,
    ticketId,
    meta: { title: ticket.title, commentId: comment.id, excerpt: body.slice(0, 120) },
  });
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
    ticketId,
    meta: { title: ticket.title },
  });
}
