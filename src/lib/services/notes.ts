import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { HttpError } from "@/lib/api";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
import { coarseBucket, dueFromDay, dayFromBucket } from "@/lib/notes-schedule";
import { zonedTime, todayYmd, workspaceTz } from "@/lib/tz";
import { htmlToPlainText } from "@/lib/utils";
import { liftChecklist, newSubtasks, parseSubtasks, MAX_SUBTASKS, type SubtaskItem } from "@/lib/subtask-list";
import { createTicket, type Actor, type ColumnRef } from "./tickets";

/**
 * "Now" as seen from the workspace timezone (KANBAI_TZ, default
 * Asia/Jerusalem). The coarse-bucket helpers in notes-schedule do calendar
 * math in the host's local zone, so they're handed a Date whose local fields
 * equal the workspace's wall clock — "today" then follows the workspace, not
 * the (usually UTC) server.
 */
function workspaceNow(now = new Date()): Date {
  const day = todayYmd(workspaceTz(), now);
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** The workspace's current "YYYY-MM-DD". */
export function notesToday(now = new Date()): string {
  return todayYmd(workspaceTz(), now);
}

/** A "YYYY-MM-DD" as an instant at noon in the workspace timezone. */
export function dayToInstant(day: string): Date {
  return zonedTime(day, 12, 0, workspaceTz());
}

const noteActor = (actor?: Actor | null): Actor => actor ?? { type: "system", name: "Kanbai" };
const excerpt = (body: string) => htmlToPlainText(body).slice(0, 120);

const noteInclude = {
  attachments: true,
  ticket: { select: { id: true, title: true, boardId: true } },
} as const;

type NoteWithRelations = Awaited<ReturnType<typeof loadNote>>;

async function loadNote(id: string) {
  const n = await db.note.findUnique({ where: { id }, include: noteInclude });
  if (!n) throw new HttpError(404, "Note not found");
  return n;
}

export function serializeNote(n: NoteWithRelations) {
  // `scheduledDay` (a local calendar day) drives concrete day placement. The
  // persisted coarse `bucket` preserves broad planning intent (notably Next
  // Week/Next Month rollover back to Unsorted).
  return {
    id: n.id,
    body: n.body,
    status: n.status,
    pinned: n.pinned,
    bucket: n.bucket,
    scheduledDay: n.scheduledDay,
    doneOn: n.doneOn,
    position: n.position,
    priority: n.priority,
    subtasks: parseSubtasks(n.subtasks),
    suggestedDueDate: dueFromDay(n.scheduledDay),
    attachments: n.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      mimeType: a.mimeType,
      filename: a.filename,
      dataUrl: a.dataUrl,
      durationMs: a.durationMs,
    })),
    ticket: n.ticket ? { id: n.ticket.id, title: n.ticket.title, boardId: n.ticket.boardId } : null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/**
 * Tasks written with a markdown checklist in their text ("- [ ] Buy a SIM",
 * the way agents used to break things down) get real subtasks, once.
 */
async function liftLegacyChecklists(where: Prisma.NoteWhereInput) {
  const rows = await db.note.findMany({
    where: { ...where, deletedAt: null, subtasks: "[]", OR: [{ body: { contains: "[ ]" } }, { body: { contains: "[x]" } }, { body: { contains: "[X]" } }] },
    select: { id: true, body: true },
  });
  for (const r of rows) {
    const { text, items } = liftChecklist(r.body);
    if (!items.length) continue;
    const subtasks = newSubtasks(items.map((i) => i.title)).map((s, i) => ({ ...s, completed: items[i].completed }));
    await db.note.update({ where: { id: r.id }, data: { body: text, subtasks: JSON.stringify(subtasks) } });
  }
}

export async function listNotesForUser(userId: string) {
  await liftLegacyChecklists({ userId });
  const notes = await db.note.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: noteInclude,
  });
  return notes.map(serializeNote);
}

/**
 * Load a note and assert it belongs to the agent's workspace — i.e. its owner
 * is a member of that workspace. 404s otherwise so we never leak existence of
 * notes in other workspaces. Returns the raw note (with relations).
 */
/**
 * Load a note that belongs to a member of `workspaceId`. Pass `restrictToUserId`
 * (an owned agent's note scope) to additionally require the note belongs to that
 * user — an owned, non-manager agent can only touch its owner's notes. A mismatch
 * 404s exactly like a missing note, so it never leaks another member's note ids.
 */
export async function getWorkspaceNote(noteId: string, workspaceId: string, restrictToUserId?: string | null) {
  const note = await db.note.findUnique({ where: { id: noteId }, include: noteInclude });
  if (!note || note.deletedAt) throw new HttpError(404, "Note not found");
  if (restrictToUserId != null && note.userId !== restrictToUserId) throw new HttpError(404, "Note not found");
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
  filters: { status?: string; bucket?: string; userId?: string } = {},
) {
  const where: Prisma.NoteWhereInput = {
    user: { workspaces: { some: { workspaceId } } },
  };
  // Soft-deleted notes live in the trash (GET /trash) — never in a listing.
  where.deletedAt = null;
  if (filters.userId) where.userId = filters.userId;
  if (filters.status) where.status = filters.status;
  if (filters.bucket) where.bucket = filters.bucket;
  await liftLegacyChecklists(where);
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

export async function createNote(
  userId: string,
  body: string,
  opts?: { scheduledDay?: string | null; bucket?: string; priority?: string; id?: string; subtasks?: string[] },
  actor?: Actor | null,
) {
  if (opts?.id) {
    // Idempotent retry: the same client id answers with the note already made.
    const existing = await db.note.findUnique({ where: { id: opts.id }, include: noteInclude });
    if (existing) {
      if (existing.userId !== userId) throw new HttpError(409, "Id already in use");
      return serializeNote(existing);
    }
  }
  // Prefer an explicit scheduledDay; fall back to mapping a legacy bucket
  // (computed against the workspace's calendar day, not the host's).
  const scheduledDay =
    opts?.scheduledDay !== undefined ? opts.scheduledDay : dayFromBucket(opts?.bucket, workspaceNow());
  const last = await db.note.findFirst({
    where: { userId, scheduledDay },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  // A checklist written into the text becomes the task's subtasks.
  const lifted = liftChecklist(body);
  body = lifted.text;
  const subtasks = [
    ...newSubtasks(lifted.items.map((i) => i.title)).map((s, i) => ({ ...s, completed: lifted.items[i].completed })),
    ...newSubtasks(opts?.subtasks ?? []),
  ].slice(0, MAX_SUBTASKS);
  const note = await db.note.create({
    data: {
      ...(opts?.id ? { id: opts.id } : {}),
      userId,
      body,
      subtasks: JSON.stringify(subtasks),
      scheduledDay,
      bucket: coarseBucket(scheduledDay, workspaceNow()),
      priority: opts?.priority ?? "none",
      position: (last?.position ?? -1) + 1,
    },
    include: noteInclude,
  });
  await logActivity({
    actor: noteActor(actor),
    action: "note.created",
    meta: { noteId: note.id, excerpt: excerpt(body), scheduledDay, userId },
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
    /** The whole checklist (replaces it). */
    subtasks: SubtaskItem[];
    /** With doneOn: tick every open subtask too. */
    completeSubtasks: boolean;
  }>,
  actor?: Actor | null,
) {
  const before = await db.note.findUnique({ where: { id: noteId }, select: { doneOn: true, body: true, subtasks: true } });
  const { subtasks: nextSubtasks, completeSubtasks, ...fields } = input;
  const data: Record<string, unknown> = { ...fields };
  let list = nextSubtasks ?? parseSubtasks(before?.subtasks);
  let listChanged = nextSubtasks !== undefined;
  if (input.body !== undefined) {
    const lifted = liftChecklist(input.body);
    if (lifted.items.length) {
      data.body = lifted.text;
      list = [...list, ...newSubtasks(lifted.items.map((i) => i.title)).map((s, i) => ({ ...s, completed: lifted.items[i].completed }))];
      listChanged = true;
    }
  }
  if (completeSubtasks && input.doneOn) {
    list = list.map((s) => ({ ...s, completed: true }));
    listChanged = true;
  }
  if (listChanged) data.subtasks = JSON.stringify(list.slice(0, MAX_SUBTASKS));
  // Keep the coarse bucket cache in sync when the schedule changes.
  if (input.scheduledDay !== undefined) data.bucket = coarseBucket(input.scheduledDay, workspaceNow());
  const note = await db.note.update({ where: { id: noteId }, data, include: noteInclude });
  const changed = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
  const nowDone = input.doneOn !== undefined && input.doneOn != null && before?.doneOn == null;
  const reopened = input.doneOn !== undefined && input.doneOn == null && before?.doneOn != null;
  await logActivity({
    actor: noteActor(actor),
    action: nowDone ? "note.done" : reopened ? "note.reopened" : "note.updated",
    meta: { noteId, excerpt: excerpt(note.body), fields: changed, ...(nowDone ? { doneOn: input.doneOn } : {}) },
  });
  return serializeNote(note);
}

/** Move a note to a scheduled day at a position, reindexing that day's group. */
export async function moveNote(
  noteId: string,
  userId: string,
  scheduledDay: string | null,
  position: number,
  actor?: Actor | null,
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
  const bucket = coarseBucket(scheduledDay, workspaceNow());
  await db.$transaction(
    targetIds.map((id, i) => db.note.update({ where: { id }, data: { scheduledDay, bucket, position: i } })),
  );
  const note = await loadNote(noteId);
  await logActivity({
    actor: noteActor(actor),
    action: "note.moved",
    meta: { noteId, excerpt: excerpt(note.body), scheduledDay, position: clamped },
  });
  return serializeNote(note);
}

/** Soft-delete: move to "Recently deleted" (restorable for 30 days, then purged). */
export async function deleteNote(noteId: string, actor?: Actor | null) {
  const note = await db.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  await logActivity({ actor: noteActor(actor), action: "note.deleted", meta: { noteId, excerpt: excerpt(note.body) } });
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

/**
 * Promote a task (note) into a ticket on a board — "Move to board" in the UI,
 * POST /notes/{id}/promote for agents — and mark the note sorted.
 */
export async function promoteNote(
  noteId: string,
  input: ColumnRef & {
    boardId: string;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
    labelIds?: string[];
    labelNames?: string[];
  },
  actor: Actor,
) {
  const note = await loadNote(noteId);
  if (note.ticket) throw new HttpError(409, "Note already sorted into a ticket");

  const ticket = await createTicket(
    {
      boardId: input.boardId,
      columnId: input.columnId ?? undefined,
      column: input.column ?? undefined,
      columnName: input.columnName ?? undefined,
      stage: input.stage ?? undefined,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      labelIds: input.labelIds,
      labelNames: input.labelNames,
      // The task's checklist comes along as the ticket's subtasks.
      subtasks: parseSubtasks(note.subtasks).map((s) => ({ title: s.title, completed: s.completed })),
    },
    actor,
  );

  // One atomic step: link the ticket to its source note AND mark the note
  // sorted — the note can never end up half-converted. "sorted" hides it from
  // the inbox but keeps it (and the link back) fully recoverable.
  await db.$transaction([
    db.ticket.update({ where: { id: ticket.id }, data: { sourceNoteId: noteId } }),
    db.note.update({ where: { id: noteId }, data: { status: "sorted" } }),
  ]);
  await logActivity({
    actor,
    action: "note.sorted",
    boardId: input.boardId,
    ticketId: ticket.id,
    meta: { noteId, excerpt: excerpt(note.body), title: ticket.title },
  });

  const linked = await db.ticket.findUnique({ where: { id: ticket.id }, include: ticketInclude });
  return linked ? serializeTicket(linked) : ticket;
}

// ── A simple task's subtasks ────────────────────────────────────────────────

async function noteSubtasks(noteId: string) {
  const n = await db.note.findUnique({ where: { id: noteId }, select: { subtasks: true } });
  if (!n) throw new HttpError(404, "Task not found");
  return parseSubtasks(n.subtasks);
}

/** Append subtasks (in order) to a simple task. */
export async function addNoteSubtasks(noteId: string, titles: string[], actor?: Actor | null) {
  const list = await noteSubtasks(noteId);
  if (list.length + titles.length > MAX_SUBTASKS) throw new HttpError(422, `A task holds at most ${MAX_SUBTASKS} subtasks`);
  const added = newSubtasks(titles);
  const note = await updateNote(noteId, { subtasks: [...list, ...added] }, actor);
  return { subtasks: added, note };
}

export async function updateNoteSubtask(noteId: string, subtaskId: string, patch: { title?: string; completed?: boolean }, actor?: Actor | null) {
  const list = await noteSubtasks(noteId);
  const current = list.find((s) => s.id === subtaskId);
  if (!current) throw new HttpError(404, "Subtask not found");
  const next = { ...current, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.completed !== undefined ? { completed: patch.completed } : {}) };
  const note = await updateNote(noteId, { subtasks: list.map((s) => (s.id === subtaskId ? next : s)) }, actor);
  return { subtask: next, note };
}

export async function deleteNoteSubtask(noteId: string, subtaskId: string, actor?: Actor | null) {
  const list = await noteSubtasks(noteId);
  if (!list.some((s) => s.id === subtaskId)) throw new HttpError(404, "Subtask not found");
  const note = await updateNote(noteId, { subtasks: list.filter((s) => s.id !== subtaskId) }, actor);
  return { note };
}
