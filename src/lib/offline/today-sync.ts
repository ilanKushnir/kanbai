// Offline-first Today: the pure half. Client-safe, no I/O.
//
// Model: what the list shows = `base` (the last state the server confirmed)
// with the outbox of not-yet-confirmed operations replayed on top. Every edit
// on Today is an operation: it is applied optimistically, persisted, and sent
// in FIFO order. A confirmed op folds the server's answer into `base`; a
// network failure leaves it queued for the next attempt. Every op is safe to
// send twice (creates carry a client-generated id the server dedupes on;
// deleting something already gone counts as done), so a request that reached
// the server but lost its response can simply be retried — no losses, no
// duplicates.

import type { TodayNote, TodayTicket } from "@/lib/today-model";
import type { SerializedTicket } from "@/lib/serialize";
import type { SubtaskItem } from "@/lib/subtask-list";

export type TodayBoardData = {
  id: string;
  name: string;
  slug: string;
  color: string;
  columns: { id: string; name: string; isDone: boolean; stage?: string | null }[];
};

export type TodayData = { tickets: TodayTicket[]; notes: TodayNote[]; boards: TodayBoardData[] };

type OpBase = { opId: string; at: string };
export type TodayOp = OpBase &
  (
    | { kind: "note.create"; note: TodayNote; body: Record<string, unknown> }
    | { kind: "note.patch"; id: string; body: Record<string, unknown>; optimistic: Partial<TodayNote> }
    | { kind: "note.delete"; id: string }
    | { kind: "ticket.create"; ticket: TodayTicket; body: Record<string, unknown> }
    | { kind: "ticket.patch"; id: string; body: Record<string, unknown>; optimistic: Partial<TodayTicket> }
    | { kind: "ticket.move"; id: string; body: Record<string, unknown>; optimistic: Partial<TodayTicket> }
    | { kind: "ticket.delete"; id: string }
    // A ticket's subtasks live in their own table, so they get their own ops.
    | { kind: "ticket.subtask.create"; ticketId: string; subtask: SubtaskItem }
    | { kind: "ticket.subtask.patch"; ticketId: string; id: string; body: { title?: string; completed?: boolean } }
    | { kind: "ticket.subtask.delete"; ticketId: string; id: string }
  );

/** Distributes Omit over the op union (plain Omit collapses it). */
export type NewTodayOp = TodayOp extends infer O ? (O extends TodayOp ? Omit<O, "opId" | "at"> : never) : never;

/** The HTTP request an op becomes. */
export function opRequest(op: TodayOp): { method: string; path: string; body?: Record<string, unknown> } {
  switch (op.kind) {
    case "note.create":
      return { method: "POST", path: "/api/notes", body: { ...op.body, id: op.note.id } };
    case "note.patch":
      return { method: "PATCH", path: `/api/notes/${op.id}`, body: op.body };
    case "note.delete":
      return { method: "DELETE", path: `/api/notes/${op.id}` };
    case "ticket.create":
      return { method: "POST", path: "/api/tickets", body: { ...op.body, id: op.ticket.id } };
    case "ticket.patch":
      return { method: "PATCH", path: `/api/tickets/${op.id}`, body: op.body };
    case "ticket.move":
      return { method: "POST", path: `/api/tickets/${op.id}/move`, body: op.body };
    case "ticket.delete":
      return { method: "DELETE", path: `/api/tickets/${op.id}` };
    case "ticket.subtask.create":
      return { method: "POST", path: `/api/tickets/${op.ticketId}/subtasks`, body: { id: op.subtask.id, title: op.subtask.title } };
    case "ticket.subtask.patch":
      return { method: "PATCH", path: `/api/tickets/${op.ticketId}/subtasks/${op.id}`, body: op.body };
    case "ticket.subtask.delete":
      return { method: "DELETE", path: `/api/tickets/${op.ticketId}/subtasks/${op.id}` };
  }
}

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/** Replay one op optimistically. Ops on rows that no longer exist are no-ops. */
export function applyOp(data: TodayData, op: TodayOp): TodayData {
  switch (op.kind) {
    case "note.create":
      return data.notes.some((n) => n.id === op.note.id) ? data : { ...data, notes: [...data.notes, op.note] };
    case "note.patch":
      return { ...data, notes: data.notes.map((n) => (n.id === op.id ? { ...n, ...op.optimistic } : n)) };
    case "note.delete":
      return { ...data, notes: data.notes.filter((n) => n.id !== op.id) };
    case "ticket.create":
      return data.tickets.some((t) => t.id === op.ticket.id) ? data : { ...data, tickets: [...data.tickets, op.ticket] };
    case "ticket.patch":
    case "ticket.move":
      return { ...data, tickets: data.tickets.map((t) => (t.id === op.id ? { ...t, ...op.optimistic } : t)) };
    case "ticket.delete":
      return { ...data, tickets: data.tickets.filter((t) => t.id !== op.id) };
    case "ticket.subtask.create":
    case "ticket.subtask.patch":
    case "ticket.subtask.delete":
      return {
        ...data,
        tickets: data.tickets.map((t) => (t.id === op.ticketId ? { ...t, subtasks: applySubtaskOp(t.subtasks ?? [], op) } : t)),
      };
  }
}

function applySubtaskOp(list: SubtaskItem[], op: Extract<TodayOp, { kind: `ticket.subtask.${string}` }>): SubtaskItem[] {
  switch (op.kind) {
    case "ticket.subtask.create":
      return list.some((s) => s.id === op.subtask.id) ? list : [...list, op.subtask];
    case "ticket.subtask.patch":
      return list.map((s) => (s.id === op.id ? { ...s, ...op.body } : s));
    case "ticket.subtask.delete":
      return list.filter((s) => s.id !== op.id);
  }
}

export const applyOps = (data: TodayData, ops: TodayOp[]) => ops.reduce(applyOp, data);

/** Fold the server's answer to a confirmed op into the base state. */
export function confirmOp(base: TodayData, op: TodayOp, response: unknown): TodayData {
  const res = (response ?? {}) as { note?: NoteResponse; ticket?: SerializedTicket };
  switch (op.kind) {
    case "note.create":
    case "note.patch":
      return res.note ? { ...base, notes: upsert(base.notes, toTodayNote(res.note)) } : applyOp(base, op);
    case "ticket.create":
    case "ticket.patch":
    case "ticket.move":
    case "ticket.subtask.create":
    case "ticket.subtask.patch":
    case "ticket.subtask.delete": {
      if (!res.ticket) return applyOp(base, op);
      const prev = base.tickets.find((t) => t.id === res.ticket!.id) ?? (op.kind === "ticket.create" ? op.ticket : undefined);
      return { ...base, tickets: upsert(base.tickets, toTodayTicket(res.ticket, base.boards, prev)) };
    }
    case "note.delete":
    case "ticket.delete":
      return applyOp(base, op);
  }
}

export type SendOutcome = "ok" | "network" | "auth" | "rejected";

/**
 * How to treat a response. 5xx gateway errors (tunnel or origin down) and
 * timeouts are "network": keep the op and retry. A 404 on delete means it is
 * already gone — done. Other 4xx are rejected for good (the op is dropped and
 * the list re-syncs from the server).
 */
export function classifyResponse(op: TodayOp, status: number): SendOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth";
  if (status === 404 && (op.kind === "note.delete" || op.kind === "ticket.delete" || op.kind === "ticket.subtask.delete")) return "ok";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "network";
  return "rejected";
}

/** A cuid-shaped id the server accepts for idempotent creates. */
export function clientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "c";
  for (const b of bytes) s += (b % 36).toString(36);
  return (s + Date.now().toString(36)).slice(0, 25).padEnd(25, "0");
}

// ── server DTO → Today rows ────────────────────────────────────────────────

export type NoteResponse = {
  id: string;
  body: string;
  status: string;
  scheduledDay: string | null;
  doneOn: string | null;
  priority: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  ticket: { id: string; title: string; boardId: string } | null;
  subtasks?: SubtaskItem[];
};

export const toTodayNote = (n: NoteResponse): TodayNote => ({
  id: n.id,
  body: n.body,
  status: n.status,
  scheduledDay: n.scheduledDay,
  doneOn: n.doneOn,
  priority: n.priority,
  position: n.position,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  ticket: n.ticket,
  subtasks: n.subtasks ?? [],
});

/** Convert a freshly-serialized ticket (API response) into a Today row. */
export function toTodayTicket(t: SerializedTicket, boards: TodayBoardData[], prev?: TodayTicket): TodayTicket {
  const b = boards.find((x) => x.id === t.boardId);
  const board = b
    ? { id: b.id, name: b.name, slug: b.slug, color: b.color, doneColumnId: b.columns.find((c) => c.isDone)?.id ?? null }
    : prev?.board ?? { id: t.boardId, name: "Board", slug: "", color: "slate", doneColumnId: null };
  const colName = t.column ?? b?.columns.find((c) => c.id === t.columnId)?.name ?? prev?.columnName ?? "";
  return {
    id: t.id,
    title: t.title,
    number: t.number,
    priority: t.priority,
    dueDate: t.dueDate,
    columnId: t.columnId,
    columnName: colName,
    subState: t.subState,
    completedAt: t.completedAt,
    isDone: t.isDone,
    board,
    labels: t.labels,
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, completed: s.completed })),
    commentCount: t.commentCount,
    createdByType: t.createdBy?.type ?? "user",
    createdAt: t.createdAt,
  };
}
