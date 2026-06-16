import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { dispatchWebhook } from "@/lib/webhooks";
import { HttpError } from "@/lib/api";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
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
  return {
    id: n.id,
    body: n.body,
    status: n.status,
    pinned: n.pinned,
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

/** All of a user's notes for the Notes surface. */
export async function listNotesForUser(userId: string) {
  const notes = await db.note.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: noteInclude,
  });
  return notes.map(serializeNote);
}

/** Notes a given agent has been asked to sort. */
export async function listInboxForAgent(agentId: string) {
  const notes = await db.note.findMany({
    where: { assignedAgentId: agentId, status: "queued" },
    orderBy: { queuedAt: "asc" },
    include: noteInclude,
  });
  return notes.map(serializeNote);
}

export async function getNoteForAgent(noteId: string, agentId: string) {
  const note = await db.note.findUnique({ where: { id: noteId }, include: noteInclude });
  if (!note || note.assignedAgentId !== agentId) {
    throw new HttpError(404, "Note not found in this agent's inbox");
  }
  return note;
}

export async function createNote(userId: string, body: string) {
  const note = await db.note.create({
    data: { userId, body },
    include: noteInclude,
  });
  return serializeNote(note);
}

export async function updateNote(
  noteId: string,
  input: Partial<{ body: string; pinned: boolean; status: string }>,
) {
  const note = await db.note.update({
    where: { id: noteId },
    data: input,
    include: noteInclude,
  });
  return serializeNote(note);
}

export async function deleteNote(noteId: string) {
  await db.note.delete({ where: { id: noteId } });
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

/** Send a captured note to an agent to sort into a real ticket. */
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
    data: {
      status: "queued",
      assignedAgentId: agentId,
      sortContext: sortContext ?? null,
      queuedAt: new Date(),
    },
    include: noteInclude,
  });
  const serialized = serializeNote(note);

  await logActivity({
    actor,
    action: "note.queued",
    meta: { noteId, agent: agent.name },
  });
  await dispatchWebhook(agentId, "note.queued", { note: serialized });
  return serialized;
}

/**
 * An agent turns a queued note into a real ticket and marks the note sorted.
 * Returns the created ticket.
 */
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
  await logActivity({
    actor,
    action: "note.sorted",
    boardId: input.boardId,
    ticketId: ticket.id,
    meta: { noteId },
  });

  const linked = await db.ticket.findUnique({ where: { id: ticket.id }, include: ticketInclude });
  return linked ? serializeTicket(linked) : ticket;
}
