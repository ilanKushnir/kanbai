// Plan — the calendar of tasks. Pure, client-safe: lays tasks, tickets and
// external calendar events onto days, and collects what still needs a day.
//
// Rules:
//   • a task's day is its scheduledDay (or the day it was done, if it never
//     had one); a ticket's day is the local day of its dueDate.
//   • the tray holds what can be planned: open tasks with no day, open
//     tickets with no due date, and anything overdue (to pull forward).
//   • events never move; they only give the day its context.

import { addDays, parseYmd, startOfDay, ymd } from "./notes-schedule";
import { compareItems, ticketDay, type TaskItem, type TodayNote, type TodayTicket } from "./today-model";
import { resolveColumnStage } from "./column-stage";

export type PlanEvent = {
  id: string;
  feedId: string;
  title: string;
  allDay: boolean;
  startDay?: string;
  endDay?: string;
  start?: string;
  end?: string;
  location?: string;
};

export type PlanColumn = { id: string; name: string; isDone: boolean; stage?: string | null };

export type PlanModel = {
  todayYmd: string;
  /** Tasks and tickets per day, open first, then by priority. */
  itemsByDay: Map<string, TaskItem[]>;
  tray: {
    tasks: { overdue: TaskItem[]; undated: TaskItem[] };
    tickets: { overdue: TaskItem[]; undated: TaskItem[] };
  };
};

export function taskItem(n: TodayNote): TaskItem {
  return { kind: "note", id: n.id, title: n.body, day: n.scheduledDay ?? n.doneOn, priority: n.priority, done: n.doneOn != null, note: n };
}

export function ticketItem(t: TodayTicket): TaskItem {
  return { kind: "ticket", id: t.id, title: t.title, day: ticketDay(t), priority: t.priority, done: t.isDone, ticket: t };
}

const STAGE_ORDER = { active: 0, backlog: 1, intake: 2, done: 3 } as const;

export function buildPlan(input: { tasks: TodayNote[]; tickets: TodayTicket[]; columns: Map<string, PlanColumn>; now?: Date }): PlanModel {
  const todayYmd = ymd(startOfDay(input.now ?? new Date()));
  const itemsByDay = new Map<string, TaskItem[]>();
  const tray: PlanModel["tray"] = { tasks: { overdue: [], undated: [] }, tickets: { overdue: [], undated: [] } };

  const place = (item: TaskItem) => {
    if (!item.day) return;
    const list = itemsByDay.get(item.day);
    if (list) list.push(item);
    else itemsByDay.set(item.day, [item]);
  };

  for (const n of input.tasks) {
    const item = taskItem(n);
    place(item);
    if (item.done) continue;
    if (!n.scheduledDay) tray.tasks.undated.push(item);
    else if (n.scheduledDay < todayYmd) tray.tasks.overdue.push(item);
  }
  for (const t of input.tickets) {
    const item = ticketItem(t);
    place(item);
    if (item.done) continue;
    if (!item.day) tray.tickets.undated.push(item);
    else if (item.day < todayYmd) tray.tickets.overdue.push(item);
  }

  for (const list of itemsByDay.values()) list.sort(compareItems);
  const byDay = (a: TaskItem, b: TaskItem) => (a.day ?? "") < (b.day ?? "") ? -1 : (a.day ?? "") > (b.day ?? "") ? 1 : compareItems(a, b);
  tray.tasks.overdue.sort(byDay);
  tray.tickets.overdue.sort(byDay);
  tray.tasks.undated.sort(compareItems);
  // Undated tickets: what's in work first, then the backlog, then ideas.
  const stage = (i: TaskItem) => {
    if (i.kind !== "ticket") return 9;
    const c = input.columns.get(i.ticket.columnId);
    return c ? STAGE_ORDER[resolveColumnStage(c.stage, c.name, c.isDone)] : 9;
  };
  tray.tickets.undated.sort((a, b) => stage(a) - stage(b) || compareItems(a, b));

  return { todayYmd, itemsByDay, tray };
}

/** The stage label of a ticket's column ("In Work", "Backlog", "Ideas"). */
export function ticketStage(t: TodayTicket, columns: Map<string, PlanColumn>) {
  const c = columns.get(t.columnId);
  return c ? resolveColumnStage(c.stage, c.name, c.isDone) : null;
}

// ── Calendar geometry ────────────────────────────────────────────────────────

export function startOfWeekDay(d: Date, weekStartsOn: number): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() - weekStartsOn + 7) % 7));
}

/** The weeks (rows of 7 days) covering the month of `anchor`. */
export function monthWeeks(anchor: Date, weekStartsOn: number): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks: Date[][] = [];
  for (let start = startOfWeekDay(first, weekStartsOn); start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

export function weekDays(anchor: Date, weekStartsOn: number): Date[] {
  const start = startOfWeekDay(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Move the anchor one period. */
export function shiftAnchor(anchor: Date, view: "month" | "week", dir: -1 | 1): Date {
  if (view === "week") return addDays(anchor, 7 * dir);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

// ── Events on days ───────────────────────────────────────────────────────────

/** Local days an event touches (all-day: inclusive range; timed: start → end, end-exclusive). */
export function eventDays(e: PlanEvent): string[] {
  let first: Date;
  let last: Date;
  if (e.allDay) {
    if (!e.startDay) return [];
    first = parseYmd(e.startDay);
    last = parseYmd(e.endDay ?? e.startDay);
  } else {
    if (!e.start) return [];
    const s = new Date(e.start);
    const end = new Date(Math.max(s.getTime(), new Date(e.end ?? e.start).getTime() - 1));
    first = startOfDay(s);
    last = startOfDay(end);
  }
  const days: string[] = [];
  for (let d = first, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) days.push(ymd(d));
  return days;
}

export function eventsByDay(events: PlanEvent[]): Map<string, PlanEvent[]> {
  const map = new Map<string, PlanEvent[]>();
  for (const e of events) {
    for (const day of eventDays(e)) {
      const list = map.get(day);
      if (list) list.push(e);
      else map.set(day, [e]);
    }
  }
  const key = (e: PlanEvent) => (e.allDay ? "0" : `1${e.start}`);
  for (const list of map.values()) list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return map;
}

/** "09:30" in the viewer's clock (24h); empty for all-day events. */
export function eventTime(e: PlanEvent): string {
  if (e.allDay || !e.start) return "";
  const d = new Date(e.start);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
