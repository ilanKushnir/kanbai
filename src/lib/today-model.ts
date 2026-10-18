// Today — the one list. Pure, client-safe: turns board tickets and notes into
// one ordered set of task rows grouped by day, judged against a local "now".
//
// Rules (deliberately few):
//   • a ticket's day is the local calendar day of its dueDate; a note's day is
//     its scheduledDay. No day = Inbox (notes) / not shown here (tickets).
//   • day < today → Overdue, day = today → Today, +1 → Tomorrow,
//     +2..+7 → This week (grouped per day), later → Later.
//   • anything completed today sits in "Done today" regardless of its day.
//   • completed before today disappears from this surface (boards keep it).

import { ymd, addDays, startOfDay, parseYmd } from "./notes-schedule";
import { PRIORITY_META, type Priority } from "./constants";
import type { SubtaskItem } from "./subtask-list";

export type TodayBoardRef = { id: string; name: string; slug: string; color: string; doneColumnId: string | null };

export type TodayTicket = {
  id: string;
  title: string;
  number: number | null;
  priority: string;
  dueDate: string | null;
  columnId: string;
  columnName: string;
  subState: string | null;
  completedAt: string | null;
  isDone: boolean;
  board: TodayBoardRef;
  labels: { id: string; name: string; color: string }[];
  /** Its checklist (absent in copies saved on the device before 0.17). */
  subtasks?: SubtaskItem[];
  commentCount: number;
  createdByType: string;
  createdAt: string;
};

export type TodayNote = {
  id: string;
  body: string;
  status: string; // inbox | queued | sorted | archived
  scheduledDay: string | null;
  doneOn: string | null;
  priority: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignedAgent: { id: string; name: string } | null;
  ticket: { id: string; title: string; boardId: string } | null;
  /** Its checklist (absent in copies saved on the device before 0.17). */
  subtasks?: SubtaskItem[];
};

export type TaskItem =
  | { kind: "ticket"; id: string; title: string; day: string | null; priority: string; done: boolean; ticket: TodayTicket }
  | { kind: "note"; id: string; title: string; day: string | null; priority: string; done: boolean; note: TodayNote };

export type SectionKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "inbox" | "done";

export type DayGroup = { day: string; label: string; sublabel: string; items: TaskItem[] };

export type TodaySection = {
  key: SectionKey;
  label: string;
  sublabel?: string;
  items: TaskItem[];
  /** "week" only: the same items grouped per day, in order. */
  groups?: DayGroup[];
};

export type TodayModel = {
  todayYmd: string;
  sections: TodaySection[];
  counts: { overdue: number; today: number; doneToday: number; inbox: number };
};

/** One locale on both server and client, so SSR markup matches hydration. */
export const LOCALE = "en-US";

const rank = (p: string) => PRIORITY_META[p as Priority]?.rank ?? 0;

export function ticketDay(t: { dueDate: string | null }): string | null {
  return t.dueDate ? ymd(new Date(t.dueDate)) : null;
}

export function ticketDoneDay(t: { completedAt: string | null; isDone: boolean }): string | null {
  if (!t.isDone) return null;
  return t.completedAt ? ymd(new Date(t.completedAt)) : null;
}

function toItems(tickets: TodayTicket[], notes: TodayNote[]): TaskItem[] {
  const items: TaskItem[] = [];
  for (const t of tickets) {
    items.push({ kind: "ticket", id: t.id, title: t.title, day: ticketDay(t), priority: t.priority, done: t.isDone, ticket: t });
  }
  for (const n of notes) {
    if (n.status !== "inbox" && n.status !== "queued") continue;
    items.push({ kind: "note", id: n.id, title: n.body, day: n.scheduledDay, priority: n.priority, done: n.doneOn != null, note: n });
  }
  return items;
}

/** Within a section: undone first, higher priority first, then stable by creation/position. */
export function compareItems(a: TaskItem, b: TaskItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const r = rank(b.priority) - rank(a.priority);
  if (r) return r;
  if (a.day !== b.day) return (a.day ?? "9999") < (b.day ?? "9999") ? -1 : 1;
  const pa = a.kind === "note" ? a.note.position : 0;
  const pb = b.kind === "note" ? b.note.position : 0;
  if (pa !== pb) return pa - pb;
  const ca = a.kind === "note" ? a.note.createdAt : a.ticket.createdAt;
  const cb = b.kind === "note" ? b.note.createdAt : b.ticket.createdAt;
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

export function dayLabel(day: string, todayYmd: string): { label: string; sublabel: string } {
  const d = parseYmd(day);
  const t = parseYmd(todayYmd);
  const delta = Math.round((startOfDay(d).getTime() - startOfDay(t).getTime()) / 86400000);
  const sublabel = d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
  if (delta === 0) return { label: "Today", sublabel };
  if (delta === 1) return { label: "Tomorrow", sublabel };
  if (delta === -1) return { label: "Yesterday", sublabel };
  if (delta > 1 && delta <= 7) return { label: d.toLocaleDateString(LOCALE, { weekday: "long" }), sublabel };
  return { label: d.toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" }), sublabel: "" };
}

export function buildToday(input: { tickets: TodayTicket[]; notes: TodayNote[]; now?: Date }): TodayModel {
  const now = input.now ?? new Date();
  const today = ymd(startOfDay(now));
  const tomorrow = ymd(addDays(startOfDay(now), 1));
  const weekEnd = ymd(addDays(startOfDay(now), 7));

  const all = toItems(input.tickets, input.notes);

  const done: TaskItem[] = [];
  const overdue: TaskItem[] = [];
  const todayItems: TaskItem[] = [];
  const tomorrowItems: TaskItem[] = [];
  const week: TaskItem[] = [];
  const later: TaskItem[] = [];
  const inbox: TaskItem[] = [];

  for (const it of all) {
    if (it.done) {
      const doneDay = it.kind === "note" ? it.note.doneOn : ticketDoneDay(it.ticket);
      if (doneDay === today) done.push(it);
      continue; // finished earlier: boards keep the history
    }
    if (it.day == null) {
      if (it.kind === "note") inbox.push(it);
      continue;
    }
    if (it.day < today) overdue.push(it);
    else if (it.day === today) todayItems.push(it);
    else if (it.day === tomorrow) tomorrowItems.push(it);
    else if (it.day <= weekEnd) week.push(it);
    else later.push(it);
  }

  for (const list of [done, overdue, todayItems, tomorrowItems, week, later, inbox]) list.sort(compareItems);

  const groups: DayGroup[] = [];
  for (const it of week) {
    const day = it.day as string;
    let g = groups.find((x) => x.day === day);
    if (!g) {
      const { label, sublabel } = dayLabel(day, today);
      g = { day, label, sublabel, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  groups.sort((a, b) => (a.day < b.day ? -1 : 1));

  const sections: TodaySection[] = [
    { key: "overdue", label: "Overdue", items: overdue },
    { key: "today", label: "Today", sublabel: parseYmd(today).toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" }), items: todayItems },
    { key: "tomorrow", label: "Tomorrow", sublabel: parseYmd(tomorrow).toLocaleDateString(LOCALE, { weekday: "long", month: "short", day: "numeric" }), items: tomorrowItems },
    { key: "week", label: "This week", items: week, groups },
    { key: "later", label: "Later", items: later },
    { key: "inbox", label: "Inbox", sublabel: "No day yet", items: inbox },
    { key: "done", label: "Done today", items: done },
  ];

  return {
    todayYmd: today,
    sections,
    counts: { overdue: overdue.length, today: todayItems.length, doneToday: done.length, inbox: inbox.length },
  };
}

/** Greeting for the hero, by local hour. */
export function greetingFor(now: Date, name?: string | null): { greeting: string; period: "morning" | "afternoon" | "evening" | "night" } {
  const h = now.getHours();
  const period = h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
  const base = period === "morning" ? "Good morning" : period === "afternoon" ? "Good afternoon" : period === "evening" ? "Good evening" : "Still up";
  const first = name?.trim().split(/\s+/)[0];
  return { greeting: first ? `${base}, ${first}.` : `${base}.`, period };
}

/** One quiet sentence summarising the day. */
export function summaryLine(counts: TodayModel["counts"]): string {
  const open = counts.overdue + counts.today;
  if (open === 0 && counts.doneToday === 0) return "Nothing scheduled for today. Add something, or enjoy the quiet.";
  if (open === 0) return `All clear — ${counts.doneToday} done today.`;
  const parts: string[] = [];
  parts.push(`${open} to do`);
  if (counts.overdue) parts.push(`${counts.overdue} overdue`);
  if (counts.doneToday) parts.push(`${counts.doneToday} done`);
  return parts.join(" · ");
}
