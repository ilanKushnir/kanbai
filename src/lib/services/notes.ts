import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { dispatchWebhook } from "@/lib/webhooks";
import { HttpError } from "@/lib/api";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
import { coarseBucket, dueFromDay, dayFromBucket } from "@/lib/notes-schedule";
import { createTicket, type Actor } from "./tickets";

const noteInclude = {
  attachments: true,
  assignedAgent: { select: { id: true, name: true, color: true, kind: true } },
  ticket: { select: { id: true, title: true, boardId: true } },
} as const;

type NoteWithRelations = Awaited<ReturnType<typeof loadNote>>;

async function loadNote(id: string) {
  const n = await db.note.findUnique({ where: { id }, include: noteInclude });
  if (!n) throw new HttpError(404, "Note not found");
  return n;
}

export function serializeNote(n: NoteWithRelations) {
  // `scheduledDay` (a local calendar day) is the source of truth; the coarse
  // `bucket` and `suggestedDueDate` are derived hints for agents.
  return {
    id: n.id,
    body: n.body,
    status: n.status,
    pinned: n.pinned,
    bucket: coarseBucket(n.scheduledDay),
    scheduledDay: n.scheduledDay,
    doneOn: n.doneOn,
    position: n.position,
    priority: n.priority,
    suggestedDueDate: dueFromDay(n.scheduledDay),
    sortContext: n.sortContext,
    assignedAgent: n.assignedAgent
      ? { id: n.assignedAgent.id, name: n.assignedAgent.name, color: n.assignedAgent.color, kind: n.assignedAgent.kind }
      : null,
    attachments: n.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      mimeType: a.mimeType,
      filename: a.filename,
      dataUrl: a.dataUrl,
      durationMs: a.durationMs,
    })),
    ticket: n.ticket ? { id: n.ticket.id, title: n.ticket.title, boardId: n.ticket.boardId } : null,
    queuedAt: n.queuedAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export async function listNotesForUser(userId: string) {
  const notes = await db.note.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: noteInclude,
  });
  return notes.map(serializeNote);
}

/** Notes queued to this agent (with bucket/priority/suggestedDueDate to file faithfully). */
export async function listInboxForAgent(agentId: string) {
  const notes = await db.note.findMany({
    where: { assignedAgentId: agentId, status: "queued", deletedAt: null },
    orderBy: { queuedAt: "asc" },
    include: noteInclude,
  });
  return notes.map(serializeNote);
}

/**
 * Load a note and assert it belongs to the agent's workspace — i.e. its owner
 * is a member of that workspace. 404s otherwise so we never leak existence of
 * notes in other workspaces. Returns the raw note (with relations).
 */
export async function getWorkspaceNote(noteId: string, workspaceId: string) {
  const note = await db.note.findUnique({ where: { id: noteId }, include: noteInclude });
  if (!note) throw new HttpError(404, "Note not found");
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: note.userId },
    select: { id: true },
  });
  if (!member) throw new HttpError(404, "Note not found");
  return note;
}

/** List notes owned by members of this workspace, with optional filters. */
export async function listNotesForWorkspace(
  workspaceId: string,
  filters: { status?: string; bucket?: string; assignedAgentId?: string; userId?: string } = {},
) {
  const where: Prisma.NoteWhereInput = {
    user: { workspaces: { some: { workspaceId } } },
  };
  if (filters.userId) where.userId = filters.userId;
  if (filters.status) where.status = filters.status;
  if (filters.bucket) where.bucket = filters.bucket;
  if (filters.assignedAgentId) where.assignedAgentId = filters.assignedAgentId;
  const notes = await db.note.findMany({
    where,
    orderBy: [{ bucket: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    include: noteInclude,
  });
  return notes.map(serializeNote);
}

/**
 * Resolve which workspace user should own an agent-created note. An explicit
 * userId/userEmail must resolve to a member of this workspace; otherwise we
 * fall back to the workspace owner (then any member).
 */
export async function resolveWorkspaceUserId(
  workspaceId: string,
  opts: { userId?: string; userEmail?: string },
): Promise<string> {
  if (opts.userId) {
    const m = await db.workspaceMember.findFirst({
      where: { workspaceId, userId: opts.userId },
      select: { userId: true },
    });
    if (!m) throw new HttpError(404, "User not found in this workspace");
    return m.userId;
  }
  if (opts.userEmail) {
    const m = await db.workspaceMember.findFirst({
      where: { workspaceId, user: { email: opts.userEmail.toLowerCase() } },
      select: { userId: true },
    });
    if (!m) throw new HttpError(404, "User not found in this workspace");
    return m.userId;
  }
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
  if (ws?.ownerId) {
    const owner = await db.workspaceMember.findFirst({
      where: { workspaceId, userId: ws.ownerId },
      select: { userId: true },
    });
    if (owner) return owner.userId;
  }
  const first = await db.workspaceMember.findFirst({
    where: { workspaceId },
    orderBy: { id: "asc" },
    select: { userId: true },
  });
  if (!first) throw new HttpError(422, "Workspace has no members to own the note");
  return first.userId;
}

export async function getNoteForAgent(noteId: string, agentId: string) {
  const note = await db.note.findUnique({ where: { id: noteId }, include: noteInclude });
  if (!note || note.deletedAt || note.assignedAgentId !== agentId) {
    throw new HttpError(404, "Note not found in this agent's inbox");
  }
  return note;
}

export async function createNote(
  userId: string,
  body: string,
  opts?: { scheduledDay?: string | null; bucket?: string; priority?: string },
) {
  // Prefer an explicit scheduledDay; fall back to mapping a legacy bucket.
  const scheduledDay =
    opts?.scheduledDay !== undefined ? opts.scheduledDay : dayFromBucket(opts?.bucket);
  const last = await db.note.findFirst({
    where: { userId, scheduledDay },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const note = await db.note.create({
    data: {
      userId,
      body,
      scheduledDay,
      bucket: coarseBucket(scheduledDay),
      priority: opts?.priority ?? "none",
      position: (last?.position ?? -1) + 1,
    },
    include: noteInclude,
  });
  return serializeNote(note);
}

export async function updateNote(
  noteId: string,
  input: Partial<{
    body: string;
    pinned: boolean;
    status: string;
    scheduledDay: string | null;
    doneOn: string | null;
    priority: string;
  }>,
) {
  const data: Record<string, unknown> = { ...input };
  // Keep the coarse bucket cache in sync when the schedule changes.
  if (input.scheduledDay !== undefined) data.bucket = coarseBucket(input.scheduledDay);
  const note = await db.note.update({ where: { id: noteId }, data, include: noteInclude });
  return serializeNote(note);
}

/** Move a note to a scheduled day at a position, reindexing that day's group. */
export async function moveNote(
  noteId: string,
  userId: string,
  scheduledDay: string | null,
  position: number,
) {
  const targetIds = (
    await db.note.findMany({
      where: { userId, scheduledDay },
      orderBy: { position: "asc" },
      select: { id: true },
    })
  )
    .map((n) => n.id)
    .filter((id) => id !== noteId);
  const clamped = Math.max(0, Math.min(position, targetIds.length));
  targetIds.splice(clamped, 0, noteId);
  const bucket = coarseBucket(scheduledDay);
  await db.$transaction(
    targetIds.map((id, i) => db.note.update({ where: { id }, data: { scheduledDay, bucket, position: i } })),
  );
  return serializeNote(await loadNote(noteId));
}

/** Soft-delete: move to "Recently deleted" (restorable for 30 days, then purged). */
export async function deleteNote(noteId: string) {
  await db.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
}

export async function addAttachment(
  noteId: string,
  input: { kind?: string; mimeType: string; dataUrl: string; filename?: string; durationMs?: number },
) {
  await db.attachment.create({
    data: {
      noteId,
      kind: input.kind ?? "audio",
      mimeType: input.mimeType,
      dataUrl: input.dataUrl,
      filename: input.filename,
      durationMs: input.durationMs,
    },
  });
  return serializeNote(await loadNote(noteId));
}

/** Mark / unmark a note for agent ingestion. */
export async function ingestNote(
  noteId: string,
  ingest: boolean,
  agentId: string | null,
  actor: Actor,
) {
  if (!ingest) {
    const note = await db.note.update({
      where: { id: noteId },
      data: { status: "inbox", assignedAgentId: null, queuedAt: null },
      include: noteInclude,
    });
    return serializeNote(note);
  }

  if (agentId) {
    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.status !== "active") agentId = null;
  }
  const note = await db.note.update({
    where: { id: noteId },
    data: { status: "queued", assignedAgentId: agentId, queuedAt: new Date() },
    include: noteInclude,
  });
  const serialized = serializeNote(note);
  await logActivity({ actor, action: "note.queued", meta: { noteId } });
  if (agentId) await dispatchWebhook(agentId, "note.queued", { note: serialized });
  return serialized;
}

/** Send a captured note to a specific agent with optional context (rich flow). */
export async function queueNoteToAgent(
  noteId: string,
  agentId: string,
  sortContext: string | undefined,
  actor: Actor,
) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new HttpError(404, "Agent not found");
  if (agent.status !== "active") throw new HttpError(422, "Agent is disabled");

  const note = await db.note.update({
    where: { id: noteId },
    data: { status: "queued", assignedAgentId: agentId, sortContext: sortContext ?? null, queuedAt: new Date() },
    include: noteInclude,
  });
  const serialized = serializeNote(note);
  await logActivity({ actor, action: "note.queued", meta: { noteId, agent: agent.name } });
  await dispatchWebhook(agentId, "note.queued", { note: serialized });
  return serialized;
}

/** An agent turns a queued note into a real ticket and marks the note sorted. */
export async function fulfillNote(
  noteId: string,
  input: {
    boardId: string;
    columnId?: string;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
    labelIds?: string[];
  },
  actor: Actor,
) {
  const note = await loadNote(noteId);
  if (note.ticket) throw new HttpError(409, "Note already sorted into a ticket");

  const ticket = await createTicket(
    {
      boardId: input.boardId,
      columnId: input.columnId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      labelIds: input.labelIds,
    },
    actor,
  );

  await db.ticket.update({ where: { id: ticket.id }, data: { sourceNoteId: noteId } });
  await db.note.update({ where: { id: noteId }, data: { status: "sorted" } });
  await logActivity({ actor, action: "note.sorted", boardId: input.boardId, ticketId: ticket.id, meta: { noteId } });

  const linked = await db.ticket.findUnique({ where: { id: ticket.id }, include: ticketInclude });
  return linked ? serializeTicket(linked) : ticket;
}
