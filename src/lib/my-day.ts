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
  /** Local YYYY-MM-DD completion day for archive grouping. */
  completedOn?: string | null;
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

/**
 * Prisma where-fragment scoping My Day to the user's own plate: only tickets
 * explicitly assigned to that human. Unassigned tickets and tickets assigned
 * to other users or to agents belong to boards, not to this user's day.
 */
export function myDayTicketScope(userId: string) {
  return { assigneeType: "user", assigneeUserId: userId } as const;
}

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

export type MyDayQueue<TTicket extends MyDayTicket = MyDayTicket, TNote extends MyDayNote = MyDayNote> = {
  /** Tickets whose due day has passed — the lane to clear first. */
  overdue: MyDayFocusItem<TTicket, TNote>[];
  /** Due-today tickets, then today's still-open scheduled notes. */
  today: MyDayFocusItem<TTicket, TNote>[];
  /** Undated tickets assigned to the user — no deadline, but on their plate. */
  anytime: MyDayFocusItem<TTicket, TNote>[];
};

/**
 * The execution queue for the My Day page: the same population as
 * {@link buildMyDayFocusItems} but split into Overdue / Today / Anytime groups,
 * and with done-today notes left out (they live in the Done archive; an
 * execution queue only lists work still open).
 */
export function buildMyDayQueue<TTicket extends MyDayTicket, TNote extends MyDayNote>(input: {
  now?: Date;
  tickets: TTicket[];
  notes: TNote[];
  userId?: string;
}): MyDayQueue<TTicket, TNote> {
  const now = input.now ?? new Date();
  const buckets = getMyDayTicketBuckets(input.tickets, now, input.userId);
  const ticketItem = (ticket: TTicket, urgent: boolean) => ({ kind: "ticket" as const, id: ticket.id, ticket, urgent });

  return {
    overdue: buckets.overdue.map((ticket) => ticketItem(ticket, true)),
    today: [
      ...buckets.today.map((ticket) => ticketItem(ticket, false)),
      ...getMyDayTodayNotes(input.notes, now)
        .filter((note) => note.doneOn == null)
        .map((note) => ({ kind: "note" as const, id: note.id, note, urgent: false as const })),
    ],
    anytime: buckets.mine.map((ticket) => ticketItem(ticket, false)),
  };
}


export type MyDayDoneArchiveItem<TTicket extends MyDayTicket = MyDayTicket, TNote extends MyDayNote = MyDayNote> =
  | { kind: "ticket"; id: string; completedOn: string; ticket: TTicket }
  | { kind: "note"; id: string; completedOn: string; note: TNote };

export type MyDayDoneArchiveGroup<TTicket extends MyDayTicket = MyDayTicket, TNote extends MyDayNote = MyDayNote> = {
  key: string;
  label: string;
  items: MyDayDoneArchiveItem<TTicket, TNote>[];
};

function archiveLabel(day: string, today: string): string {
  if (day === today) return "Today";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function buildMyDayDoneArchive<TTicket extends MyDayTicket, TNote extends MyDayNote>(input: {
  now?: Date;
  tickets: TTicket[];
  notes: TNote[];
  limit?: number;
}): {
  collapsedByDefault: true;
  total: number;
  hasMore: boolean;
  groups: MyDayDoneArchiveGroup<TTicket, TNote>[];
} {
  const now = input.now ?? new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const limit = input.limit ?? 12;
  const items: MyDayDoneArchiveItem<TTicket, TNote>[] = [
    ...input.tickets
      .filter((ticket) => !!ticket.completedOn)
      .map((ticket) => ({ kind: "ticket" as const, id: ticket.id, completedOn: ticket.completedOn as string, ticket })),
    ...input.notes
      .filter((note) => !!note.doneOn)
      .map((note) => ({ kind: "note" as const, id: note.id, completedOn: note.doneOn as string, note })),
  ].sort((a, b) => b.completedOn.localeCompare(a.completedOn));

  const groups: MyDayDoneArchiveGroup<TTicket, TNote>[] = [];
  const allGroupKeys = Array.from(new Set(items.map((item) => item.completedOn)));
  const visibleKeys = new Set(allGroupKeys.slice(0, limit));
  for (const item of items) {
    if (!visibleKeys.has(item.completedOn)) continue;
    let group = groups.find((g) => g.key === item.completedOn);
    if (!group) {
      group = { key: item.completedOn, label: archiveLabel(item.completedOn, today), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return { collapsedByDefault: true, total: items.length, hasMore: allGroupKeys.length > visibleKeys.size, groups };
}
