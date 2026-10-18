import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { ticketInclude, serializeTicket, type UserLite } from "@/lib/serialize";
import { parseSubStates } from "@/lib/substates";
import { boardAssigneeUsers } from "./board-members";
import type { serializeNote } from "./notes";
import type { TodayNote, TodayTicket } from "@/lib/today-model";

/** The rows Today and Plan render: tickets with their board, notes as tasks. */

export const ticketRowInclude = {
  ...ticketInclude,
  board: { select: { id: true, slug: true, name: true, color: true } },
} satisfies Prisma.TicketInclude;

type TicketRowSource = Prisma.TicketGetPayload<{ include: typeof ticketRowInclude }>;

export function toTicketRow(t: TicketRowSource, usersById: Map<string, UserLite>, doneColumnByBoard: Map<string, string | null>): TodayTicket {
  const s = serializeTicket(t, usersById);
  return {
    id: s.id,
    title: s.title,
    number: s.number,
    priority: s.priority,
    dueDate: s.dueDate,
    columnId: s.columnId,
    columnName: s.column ?? "",
    subState: s.subState,
    completedAt: s.completedAt,
    isDone: s.isDone,
    board: { id: t.board.id, name: t.board.name, slug: t.board.slug, color: t.board.color, doneColumnId: doneColumnByBoard.get(t.board.id) ?? null },
    labels: s.labels,
    subtasks: s.subtasks.map((x) => ({ id: x.id, title: x.title, completed: x.completed })),
    commentCount: s.commentCount,
    createdByType: s.createdBy.type,
    createdAt: s.createdAt,
  };
}

/** Only live captures are tasks: sorted (promoted) and archived notes are not. */
export function isTaskNote(n: { status: string }) {
  return n.status === "inbox";
}

export function toNoteRow(n: ReturnType<typeof serializeNote>): TodayNote {
  return {
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
    subtasks: n.subtasks,
  };
}

/** What the ?ticket= modal needs, or null when the ticket isn't visible to this user. */
export async function loadTicketModal(ticketId: string | undefined, boardWhere: Prisma.BoardWhereInput, usersById: Map<string, UserLite>) {
  if (!ticketId) return null;
  const ticket = await db.ticket.findFirst({ where: { id: ticketId, deletedAt: null, board: boardWhere }, include: ticketInclude });
  if (!ticket) return null;
  const [board, members] = await Promise.all([
    db.board.findFirst({
      where: { id: ticket.boardId },
      select: {
        columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true, subStates: true } },
        labels: { orderBy: { name: "asc" }, select: { id: true, name: true, color: true } },
      },
    }),
    boardAssigneeUsers(ticket.boardId),
  ]);
  if (!board) return null;
  return {
    ticket: serializeTicket(ticket, usersById),
    columns: board.columns.map((c) => ({ ...c, subStates: parseSubStates(c.subStates) })),
    labels: board.labels,
    members,
  };
}
