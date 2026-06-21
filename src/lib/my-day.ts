import {
  buildSchedule,
  compareSectionNotes,
  isSectionVisibleNote,
  noteSectionKey,
} from "@/lib/notes-schedule";
import { PRIORITY_META, type Priority } from "@/lib/constants";

export type MyDayTicket = {
  id: string;
  dueDate: string | null;
  priority: string;
  assignee?: { type: string; id: string } | null;
};

export type MyDayNote = {
  id: string;
  body: string;
  status: string;
  scheduledDay: string | null;
  bucket?: string | null;
  doneOn: string | null;
  position: number;
  createdAt: string;
};

export type MyDayFocusItem<TTicket extends MyDayTicket = MyDayTicket, TNote extends MyDayNote = MyDayNote> =
  | { kind: "ticket"; id: string; ticket: TTicket; urgent: boolean }
  | { kind: "note"; id: string; note: TNote; urgent: false };

function dayBounds(now: Date) {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endToday = startToday + 86400000 - 1;
  const endWeek = startToday + 7 * 86400000;
  return { startToday, endToday, endWeek };
}

const rank = (p: string) => PRIORITY_META[(p as Priority)]?.rank ?? 0;
const dueTime = (ticket: MyDayTicket) => (ticket.dueDate ? new Date(ticket.dueDate).getTime() : null);

export function getMyDayTicketBuckets<TTicket extends MyDayTicket>(tickets: TTicket[], now = new Date(), userId?: string) {
  const { startToday, endToday, endWeek } = dayBounds(now);
  const rows = tickets.slice().sort((a, b) => {
    const da = dueTime(a) ?? Infinity;
    const db = dueTime(b) ?? Infinity;
    return da - db || rank(b.priority) - rank(a.priority);
  });

  const overdue = rows.filter((r) => dueTime(r) !== null && (dueTime(r) as number) < startToday);
  const today = rows.filter((r) => dueTime(r) !== null && (dueTime(r) as number) >= startToday && (dueTime(r) as number) <= endToday);
  const week = rows.filter((r) => dueTime(r) !== null && (dueTime(r) as number) > endToday && (dueTime(r) as number) <= endWeek);
  const datedIds = new Set([...overdue, ...today, ...week].map((r) => r.id));
  const mine = userId
    ? rows.filter((r) => !datedIds.has(r.id) && r.assignee?.type === "user" && r.assignee.id === userId)
    : [];

  return { rows, overdue, today, week, mine };
}

export function getMyDayTodayNotes<TNote extends MyDayNote>(notes: TNote[], now = new Date()): TNote[] {
  const schedule = buildSchedule(now);
  return notes
    .filter((note) =>
      note.status === "inbox" &&
      note.doneOn == null &&
      isSectionVisibleNote(note, schedule.todayYmd) &&
      noteSectionKey(schedule, note) === "today",
    )
    .slice()
    .sort(compareSectionNotes);
}

export function countMyDayUnsortedNotes<TNote extends MyDayNote>(_input: { now?: Date; notes: TNote[]; tickets?: MyDayTicket[] }): number {
  const now = _input.now ?? new Date();
  const schedule = buildSchedule(now);
  return _input.notes.filter(
    (note) =>
      note.status === "inbox" &&
      isSectionVisibleNote(note, schedule.todayYmd) &&
      noteSectionKey(schedule, note) === "general",
  ).length;
}

export function buildMyDayFocusItems<TTicket extends MyDayTicket, TNote extends MyDayNote>(input: {
  now?: Date;
  tickets: TTicket[];
  notes: TNote[];
  userId?: string;
}): MyDayFocusItem<TTicket, TNote>[] {
  const now = input.now ?? new Date();
  const buckets = getMyDayTicketBuckets(input.tickets, now, input.userId);
  const overdueIds = new Set(buckets.overdue.map((ticket) => ticket.id));

  return [
    ...buckets.overdue.map((ticket) => ({ kind: "ticket" as const, id: ticket.id, ticket, urgent: true })),
    ...buckets.today.map((ticket) => ({ kind: "ticket" as const, id: ticket.id, ticket, urgent: overdueIds.has(ticket.id) })),
    ...getMyDayTodayNotes(input.notes, now).map((note) => ({ kind: "note" as const, id: note.id, note, urgent: false as const })),
    ...buckets.mine.map((ticket) => ({ kind: "ticket" as const, id: ticket.id, ticket, urgent: false })),
  ];
}
