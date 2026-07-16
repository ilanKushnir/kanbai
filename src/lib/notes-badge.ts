// The Notes nav badge: how many items are asking for attention *today*.
//
// Counts exactly what the Notes page shows in its "Today" section, using the
// same scheduling semantics (notes-schedule.ts):
//   • scheduled notes whose section resolves to "today" (due today or overdue,
//     minus coarse-bucket rollovers that return to Unsorted), and
//   • reflected board tickets due today or overdue.
// Completed items are excluded — a done-today note lingers in the section for
// the day, and a done ticket may still reflect until its due day passes, but
// neither needs attention, so the badge only counts actionable work.

import { buildSchedule, isSectionVisibleNote, noteSectionKey, ymd } from "@/lib/notes-schedule";

export type BadgeNote = {
  status: string;
  scheduledDay: string | null;
  bucket?: string | null;
  doneOn: string | null;
};

export type BadgeReflection = {
  /** Due instant of a non-deleted board ticket the user can see. */
  dueDate: string | Date;
  /** Whether the ticket sits in a done column (reflected but not actionable). */
  done: boolean;
};

export function countNotesAttention(input: {
  now?: Date;
  notes: BadgeNote[];
  reflections: BadgeReflection[];
}): number {
  const now = input.now ?? new Date();
  const schedule = buildSchedule(now);

  const dueNotes = input.notes.filter(
    (note) =>
      note.doneOn == null &&
      isSectionVisibleNote(note, schedule.todayYmd) &&
      noteSectionKey(schedule, note) === "today",
  );
  const dueTickets = input.reflections.filter(
    (r) => !r.done && ymd(new Date(r.dueDate)) <= schedule.todayYmd,
  );

  return dueNotes.length + dueTickets.length;
}
