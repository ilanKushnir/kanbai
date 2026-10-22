import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { ticketInclude, serializeTicket, type SerializedTicket, type UserLite } from "@/lib/serialize";
import { resolveColumnStage } from "@/lib/column-stage";
import { PRIORITY_META, type Priority } from "@/lib/constants";
import { getDayPlans } from "@/lib/services/day-plans";
import type { PlanEntry } from "@/lib/day-plan";
import { addDaysYmd, endOfDayInTz, startOfDayInTz, todayYmd, workspaceTz, ymdInTz } from "@/lib/tz";
import { serializeNote } from "./notes";

/**
 * The day's agenda — one plain, serializable object the agent API (`GET
 * /api/v1/today`) and the UI's Today page both render from. Every calendar
 * boundary is computed in the workspace timezone (KANBAI_TZ, default
 * Asia/Jerusalem), never the host's.
 */

export type AgendaBoard = {
  id: string;
  name: string;
  slug: string;
  color: string;
  /** First isDone column by position — complete a ticket with one move, no lookup. */
  doneColumnId: string | null;
};

export type AgendaColumn = { id: string; name: string; isDone: boolean; stage: string };

/**
 * A serialized ticket plus its board and column. NOTE: on single-ticket
 * endpoints `column` is the column NAME (string); here it is the column object
 * and the name is mirrored on `columnName`.
 */
export type AgendaTicket = Omit<SerializedTicket, "column"> & {
  board: AgendaBoard;
  column: AgendaColumn;
  columnName: string;
};

export type AgendaNote = ReturnType<typeof serializeNote>;

export type Agenda = {
  date: string;
  timezone: string;
  overdue: AgendaTicket[];
  today: AgendaTicket[];
  tomorrow: AgendaTicket[];
  /** Due in the next 7 days, excluding today and tomorrow. */
  upcoming: AgendaTicket[];
  /**
   * How the person arranged today and tomorrow in the app: ticket and task ids
   * in the order they mean to do them, each with a part of the day (morning |
   * afternoon | evening, or null). Missing ids haven't been placed yet.
   */
  plan: { today: PlanEntry[]; tomorrow: PlanEntry[] };
  /** Open, unscheduled notes (status inbox, no scheduledDay, not done, not deleted). */
  inbox: AgendaNote[];
  /** Notes scheduled for today or earlier, not done, not deleted. */
  notesToday: AgendaNote[];
  doneToday: { tickets: AgendaTicket[]; notes: AgendaNote[] };
};

const rank = (p: string) => PRIORITY_META[p as Priority]?.rank ?? 0;

/** Soonest due first, then higher priority, then newest. */
export function compareAgendaTickets(a: { dueDate: string | null; priority: string; createdAt: string }, b: typeof a) {
  const da = a.dueDate ? Date.parse(a.dueDate) : Infinity;
  const db_ = b.dueDate ? Date.parse(b.dueDate) : Infinity;
  return da - db_ || rank(b.priority) - rank(a.priority) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

const agendaInclude = {
  ...ticketInclude,
  column: { select: { id: true, name: true, isDone: true, stage: true } },
  board: {
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      columns: { where: { isDone: true }, orderBy: { position: "asc" as const }, take: 1, select: { id: true } },
    },
  },
} satisfies Prisma.TicketInclude;

type AgendaRow = Prisma.TicketGetPayload<{ include: typeof agendaInclude }>;

export function toAgendaTicket(t: AgendaRow, usersById?: Map<string, UserLite>): AgendaTicket {
  return {
    ...serializeTicket(t, usersById),
    columnName: t.column.name,
    board: {
      id: t.board.id,
      name: t.board.name,
      slug: t.board.slug,
      color: t.board.color,
      doneColumnId: t.board.columns[0]?.id ?? null,
    },
    column: {
      id: t.column.id,
      name: t.column.name,
      isDone: t.column.isDone,
      stage: resolveColumnStage(t.column.stage, t.column.name, t.column.isDone),
    },
  };
}

/** Workspace members keyed by id, for resolving legacy single assignees to names. */
export async function workspaceUsersById(workspaceId: string): Promise<Map<string, UserLite>> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    select: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
  });
  return new Map(members.map((m) => [m.user.id, m.user]));
}

/** Shared include + mapper so `/tickets` and `/today` serialize identically. */
export { agendaInclude as ticketListInclude };

export async function getAgenda(input: {
  workspaceId: string;
  /** Whose notes (and, with scope "mine", whose tickets) make up the day. */
  userId: string;
  /** Prisma `where` limiting boards (access cap). Defaults to every board in the workspace. */
  boardWhere?: Prisma.BoardWhereInput;
  now?: Date;
  /** "all" (default): every ticket on the visible boards; "mine": only tickets assigned to userId. */
  scope?: "all" | "mine";
  timezone?: string;
}): Promise<Agenda> {
  const tz = input.timezone ?? workspaceTz();
  const now = input.now ?? new Date();
  const date = todayYmd(tz, now);
  const tomorrow = addDaysYmd(date, 1);
  const startToday = startOfDayInTz(date, tz);
  const startTomorrow = endOfDayInTz(date, tz);
  const endTomorrow = endOfDayInTz(tomorrow, tz);
  const endWeek = endOfDayInTz(addDaysYmd(date, 7), tz);

  const board: Prisma.BoardWhereInput = { workspaceId: input.workspaceId, archived: false, ...(input.boardWhere ?? {}) };
  // "mine": only tickets explicitly assigned to the user (primary or co-assignee).
  const scope: Prisma.TicketWhereInput =
    input.scope === "mine"
      ? { assigneeType: "user", OR: [{ assigneeUserId: input.userId }, { assignees: { some: { userId: input.userId } } }] }
      : {};
  const usersById = await workspaceUsersById(input.workspaceId);

  const [openRows, doneRows, noteRows] = await Promise.all([
    db.ticket.findMany({
      where: { board, deletedAt: null, column: { isDone: false }, dueDate: { not: null, lt: endWeek }, ...scope },
      include: agendaInclude,
    }),
    db.ticket.findMany({
      where: {
        board,
        deletedAt: null,
        column: { isDone: true },
        OR: [{ completedAt: { gte: startToday, lt: startTomorrow } }, { completedAt: null, updatedAt: { gte: startToday, lt: startTomorrow } }],
        ...scope,
      },
      include: agendaInclude,
    }),
    db.note.findMany({
      where: { userId: input.userId, deletedAt: null, status: "inbox" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        attachments: true,
        ticket: { select: { id: true, title: true, boardId: true } },
      },
    }),
  ]);

  const open = openRows.map((t) => toAgendaTicket(t, usersById)).sort(compareAgendaTickets);
  const due = (t: AgendaTicket) => Date.parse(t.dueDate!);
  const overdue = open.filter((t) => due(t) < startToday.getTime());
  const today = open.filter((t) => due(t) >= startToday.getTime() && due(t) < startTomorrow.getTime());
  const tomorrowList = open.filter((t) => due(t) >= startTomorrow.getTime() && due(t) < endTomorrow.getTime());
  const upcoming = open.filter((t) => due(t) >= endTomorrow.getTime());

  const doneTickets = doneRows
    .map((t) => toAgendaTicket(t, usersById))
    .sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt));

  const plans = await getDayPlans(input.userId, input.workspaceId, [date, tomorrow]);
  const notes = noteRows.map(serializeNote);
  const inbox = notes.filter((n) => n.scheduledDay == null && n.doneOn == null);
  const notesToday = notes.filter((n) => n.scheduledDay != null && n.scheduledDay <= date && n.doneOn == null);
  const doneNotes = notes.filter((n) => n.doneOn === date);

  return {
    date,
    timezone: tz,
    overdue,
    today,
    tomorrow: tomorrowList,
    upcoming,
    plan: { today: plans[date] ?? [], tomorrow: plans[tomorrow] ?? [] },
    inbox,
    notesToday,
    doneToday: { tickets: doneTickets, notes: doneNotes },
  };
}

/** The workspace day a ticket's due instant falls on (for display grouping). */
export function dueDayOf(ticket: { dueDate: string | null }, tz = workspaceTz()): string | null {
  return ticket.dueDate ? ymdInTz(new Date(ticket.dueDate), tz) : null;
}
