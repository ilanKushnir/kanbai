// Week View date logic for a board — pure, timezone-proof (mirrors
// notes-schedule.ts). A week is 7 local calendar days ("YYYY-MM-DD" strings)
// anchored on the user's week-start preference; a ticket lands on the local
// day of its due instant, or in the "unscheduled" bucket when it has no due
// date. Safe to import on both the client and the server.

import { addDays, startOfDay, ymd } from "./notes-schedule";
import { PRIORITY_META, type Priority } from "./constants";

export type WeekDay = {
  /** Local calendar day "YYYY-MM-DD" — the grouping key. */
  ymd: string;
  date: Date;
};

/** The local start-of-week containing `now`. `weekStartsOn`: 0 = Sunday … 6 = Saturday. */
export function startOfWeek(now: Date, weekStartsOn = 0): Date {
  const today = startOfDay(now);
  const offset = (today.getDay() - weekStartsOn + 7) % 7;
  return addDays(today, -offset);
}

/** The 7 days of the week beginning at `start` (a local start-of-week date). */
export function buildWeekDays(start: Date): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { ymd: ymd(date), date };
  });
}

/** Range header for a week, e.g. "Jul 13 – 19, 2026" or "Jun 29 – Jul 5, 2026". */
export function weekRangeLabel(days: WeekDay[]): string {
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  const from = first.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const to = last.toLocaleDateString(undefined, {
    ...(sameMonth ? {} : { month: "short" as const }),
    day: "numeric",
  });
  return `${from} – ${to}, ${last.getFullYear()}`;
}

export type WeekViewTicket = {
  id: string;
  dueDate: string | null;
  priority: string;
  createdAt: string;
  /** True when the ticket sits in a done column — sinks below open work. */
  done?: boolean;
};

/** The local calendar day a due instant falls on, or null when undated. */
export function dueDayOf(ticket: Pick<WeekViewTicket, "dueDate">): string | null {
  return ticket.dueDate ? ymd(new Date(ticket.dueDate)) : null;
}

const rank = (p: string) => PRIORITY_META[p as Priority]?.rank ?? 0;

/**
 * Order tickets within one day (or the unscheduled bucket): open work before
 * done, then earlier due instants first, then higher priority, then original
 * creation order as a stable tiebreaker.
 */
export function compareWeekTickets(a: WeekViewTicket, b: WeekViewTicket): number {
  const doneDelta = (a.done ? 1 : 0) - (b.done ? 1 : 0);
  if (doneDelta !== 0) return doneDelta;
  const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  return dueA - dueB || rank(b.priority) - rank(a.priority) || a.createdAt.localeCompare(b.createdAt);
}

export type WeekGroups<T extends WeekViewTicket> = {
  /** One (possibly empty) sorted list per day of the week, keyed by "YYYY-MM-DD". */
  byDay: Record<string, T[]>;
  /** Undated tickets (all of them — callers decide whether done ones are worth showing). */
  unscheduled: T[];
};

/**
 * Bucket a board's tickets into the given week. Tickets due outside the week
 * are omitted — they belong to the week the user navigates to — and undated
 * tickets collect in `unscheduled`.
 */
export function groupTicketsByWeekDay<T extends WeekViewTicket>(tickets: T[], days: string[]): WeekGroups<T> {
  const byDay: Record<string, T[]> = Object.fromEntries(days.map((d) => [d, []]));
  const unscheduled: T[] = [];
  for (const t of tickets) {
    const day = dueDayOf(t);
    if (day == null) unscheduled.push(t);
    else if (day in byDay) byDay[day].push(t);
  }
  for (const d of days) byDay[d].sort(compareWeekTickets);
  unscheduled.sort(compareWeekTickets);
  return { byDay, unscheduled };
}
