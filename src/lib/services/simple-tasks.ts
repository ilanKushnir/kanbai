import { addDaysYmd } from "@/lib/tz";
import { notesToday, serializeNote } from "./notes";
import type { SubtaskItem } from "@/lib/subtask-list";

/**
 * Simple tasks are the agent-facing name for Today's plain to-dos ("order
 * meat"): a Note with a day, no board, no columns. This module only translates
 * between that vocabulary and the note model — storage and logging stay in
 * services/notes so the UI and the agent share one task model.
 */

export type SimpleTask = {
  id: string;
  kind: "task";
  title: string;
  /** Local "YYYY-MM-DD" it's planned for; null = someday (Inbox). */
  day: string | null;
  done: boolean;
  doneOn: string | null;
  priority: string;
  /** Its checklist, in order. */
  subtasks: SubtaskItem[];
  /** Set once the task was promoted to a board ticket. */
  ticket: { id: string; title: string; boardId: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** "today" | "tomorrow" | "someday" | "YYYY-MM-DD" | null → a scheduledDay. */
export function resolveTaskDay(day: string | null | undefined, now = new Date()): string | null {
  if (day === undefined || day === "today") return notesToday(now);
  if (day === "tomorrow") return addDaysYmd(notesToday(now), 1);
  if (day === null || day === "someday") return null;
  return day;
}

export function toSimpleTask(n: ReturnType<typeof serializeNote>): SimpleTask {
  return {
    id: n.id,
    kind: "task",
    title: n.body,
    day: n.scheduledDay,
    done: n.doneOn != null,
    doneOn: n.doneOn,
    priority: n.priority,
    subtasks: n.subtasks,
    ticket: n.ticket,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}
