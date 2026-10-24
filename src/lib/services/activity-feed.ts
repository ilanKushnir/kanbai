import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { htmlToPlainText } from "@/lib/utils";

/**
 * The workspace activity feed: ActivityLog rows joined with the ticket /
 * board / note they refer to, so the UI and agents can render "Hermes moved
 * #12 to Done" without further lookups. Rows for deleted tickets/notes keep
 * their meta (title/excerpt) so the line still reads.
 */

export type ActivityItem = {
  id: string;
  actorType: string; // "user" | "agent" | "system"
  actorId: string | null;
  actorName: string;
  /** For an agent with an owner: whose agent it is ("Mika · Yuval"). */
  actorOwnerName?: string | null;
  action: string; // "ticket.created", "ticket.done", "note.done", ...
  createdAt: string;
  ticket?: { id: string; title: string; number: number | null; boardSlug: string; boardName: string };
  board?: { id: string; name: string; slug: string };
  note?: { id: string; body: string };
  meta: Record<string, unknown>;
};

export type ListActivityInput = {
  workspaceId: string;
  limit?: number;
  /** "agent" | "user" | "system" | "all" (default). */
  actorType?: string | null;
  boardId?: string | null;
  since?: Date | string | null;
  /** Restrict board-scoped rows to these boards (access cap); workspace-wide rows (notes) always pass. */
  boardIds?: string[] | null;
  /** Only these actions (e.g. TASK_ACTIONS). */
  actions?: readonly string[] | null;
  /** Keep only this user's note rows — notes are personal, other members' captures aren't "my" changes. */
  noteUserId?: string | null;
};

/** What happened to a task or ticket: added, done, reopened, moved, rescheduled, edited, removed, filed. */
export const TASK_ACTIONS = [
  "ticket.created",
  "ticket.updated",
  "ticket.moved",
  "ticket.done",
  "ticket.reopened",
  "ticket.transferred",
  "ticket.deleted",
  "note.created",
  "note.updated",
  "note.done",
  "note.reopened",
  "note.moved",
  "note.deleted",
  "note.sorted",
  "note.promoted",
] as const;

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function listActivity(input: ListActivityInput): Promise<ActivityItem[]> {
  const limit = Math.min(500, Math.max(1, input.limit ?? 50));
  const since = input.since ? new Date(input.since) : null;

  // Board-scoped rows must belong to this workspace (and the allowed boards);
  // rows with no board (notes) belong to the workspace's members' notes — they
  // carry a noteId in meta, which we resolve to its owner's membership below.
  const boardFilter: Prisma.BoardWhereInput = {
    workspaceId: input.workspaceId,
    ...(input.boardIds ? { id: { in: input.boardIds } } : {}),
  };
  const where: Prisma.ActivityLogWhereInput = {
    OR: [{ board: boardFilter }, { boardId: null }],
    ...(input.boardId ? { boardId: input.boardId } : {}),
    ...(input.actorType && input.actorType !== "all" ? { actorType: input.actorType } : {}),
    ...(input.actions ? { action: { in: [...input.actions] } } : {}),
    ...(since && !Number.isNaN(since.getTime()) ? { createdAt: { gt: since } } : {}),
  };

  const rows = await db.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit * 2, // headroom for workspace-filtering of note rows below
    include: { board: { select: { id: true, name: true, slug: true } } },
  });

  const ticketIds = [...new Set(rows.map((r) => r.ticketId).filter((id): id is string => !!id))];
  const noteIds = [...new Set(rows.map((r) => parseMeta(r.meta).noteId).filter((id): id is string => typeof id === "string"))];

  const agentIds = [...new Set(rows.filter((r) => r.actorType === "agent" && r.actorId).map((r) => r.actorId!))];
  const [tickets, notes, members, agents] = await Promise.all([
    ticketIds.length
      ? db.ticket.findMany({
          where: { id: { in: ticketIds } },
          select: { id: true, title: true, number: true, board: { select: { slug: true, name: true } } },
        })
      : [],
    noteIds.length ? db.note.findMany({ where: { id: { in: noteIds } }, select: { id: true, body: true, userId: true } }) : [],
    db.workspaceMember.findMany({ where: { workspaceId: input.workspaceId }, select: { userId: true } }),
    agentIds.length
      ? db.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, workspaceId: true, ownerUser: { select: { name: true } }, workspace: { select: { owner: { select: { name: true } } } } },
        })
      : [],
  ]);
  // Whose agent it is: its owner — or, for a workspace-wide agent from another
  // workspace (acting on a board shared with its people), that workspace's owner.
  const agentOwner = new Map(
    agents.map((a) => [a.id, a.ownerUser?.name ?? (a.workspaceId !== input.workspaceId ? a.workspace.owner?.name ?? null : null)]),
  );
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const memberIds = new Set(members.map((m) => m.userId));

  const items: ActivityItem[] = [];
  for (const r of rows) {
    const meta = parseMeta(r.meta);
    const noteId = typeof meta.noteId === "string" ? meta.noteId : null;
    const note = noteId ? noteById.get(noteId) : undefined;
    // A board-less row that names a note belonging to another workspace's user is not ours.
    if (!r.boardId && note && !memberIds.has(note.userId)) continue;
    if (input.noteUserId && !r.boardId && (note ? note.userId : meta.userId ?? input.noteUserId) !== input.noteUserId) continue;
    const t = r.ticketId ? ticketById.get(r.ticketId) : undefined;

    const item: ActivityItem = {
      id: r.id,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorName,
      ...(r.actorType === "agent" && r.actorId && agentOwner.get(r.actorId) ? { actorOwnerName: agentOwner.get(r.actorId) } : {}),
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      meta,
    };
    if (t) {
      item.ticket = { id: t.id, title: t.title, number: t.number, boardSlug: t.board.slug, boardName: t.board.name };
    } else if (r.ticketId && typeof meta.title === "string" && r.board) {
      // Ticket gone (purged) — keep the line readable from the stored title.
      item.ticket = { id: r.ticketId, title: meta.title, number: null, boardSlug: r.board.slug, boardName: r.board.name };
    }
    if (r.board) item.board = { id: r.board.id, name: r.board.name, slug: r.board.slug };
    if (note) {
      item.note = { id: note.id, body: htmlToPlainText(note.body).slice(0, 120) };
    } else if (noteId && typeof meta.excerpt === "string") {
      item.note = { id: noteId, body: meta.excerpt.slice(0, 120) };
    }
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}
