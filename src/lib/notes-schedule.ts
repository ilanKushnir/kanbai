// Scheduled-day model for Notes — pure, timezone-proof date logic.
//
// A note's time placement is a local calendar day stored as a "YYYY-MM-DD"
// string (`scheduledDay`), or null for the unscheduled "General" bucket. The
// "done" flag is the local day a note was completed (`doneOn`), or null.
//
// Because everything is a calendar-day string compared against *today*, time
// buckets roll forward on their own: a note dated tomorrow becomes "Today" once
// tomorrow arrives, with no cron and no timezone drift. This file is the single
// source of truth and is safe to import on both the client and the server.

export type SectionKind = "today" | "day" | "next_week" | "next_month" | "general";

export type NoteSection = {
  /** Stable container id for drag-and-drop (e.g. "today", "day:2026-06-20", "general"). */
  key: string;
  label: string;
  /** Secondary line, e.g. "Jun 20" for a weekday slot. */
  sublabel?: string;
  /** The scheduledDay a note dropped here gets, or null for General. */
  day: string | null;
  kind: SectionKind;
};

// ── day-string helpers ───────────────────────────────────────────────────────

/** Local calendar day as "YYYY-MM-DD". */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" into a local Date at midnight. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "YYYY-MM-DD" → an ISO instant at local noon (a stable due-date hint). */
export function dueFromDay(day: string | null): string | null {
  if (!day) return null;
  const d = parseYmd(day);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// ── schedule (sections + classification for "now") ───────────────────────────

export type Schedule = {
  todayYmd: string;
  sections: NoteSection[];
  /** Which section key a note with the given scheduledDay belongs to. */
  classify: (day: string | null) => string;
};

/**
 * Build the ordered time-sections for a given moment and week-start preference.
 * `weekStartsOn`: 0 = Sunday … 6 = Saturday.
 */
export function buildSchedule(now: Date, weekStartsOn = 0): Schedule {
  const today = startOfDay(now);
  const todayYmd = ymd(today);

  // How many days remain in the current week *after* today.
  const offsetFromWeekStart = (today.getDay() - weekStartsOn + 7) % 7; // 0..6
  const daysLeftThisWeek = 6 - offsetFromWeekStart;
  // On the LAST day of the week (e.g. Saturday with a Sunday start) nothing
  // would remain, so "This week" would vanish. Roll the window forward to the
  // upcoming week instead so the day-split is always there to plan into.
  const daySlotCount = daysLeftThisWeek === 0 ? 6 : daysLeftThisWeek;

  // "Unsorted" (no day) leads — the default landing for quick captures.
  const sections: NoteSection[] = [
    { key: "general", label: "Unsorted", day: null, kind: "general" },
    {
      key: "today",
      label: "Today",
      sublabel: today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      day: todayYmd,
      kind: "today",
    },
  ];

  // Remaining days of this week become individual "This week" day slots.
  for (let i = 1; i <= daySlotCount; i++) {
    const d = addDays(today, i);
    sections.push({
      key: `day:${ymd(d)}`,
      label: d.toLocaleDateString(undefined, { weekday: "long" }),
      sublabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      day: ymd(d),
      kind: "day",
    });
  }

  const startNextWeek = addDays(today, daySlotCount + 1);
  const startBeyond = addDays(startNextWeek, 7); // first day past "next week"
  const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  sections.push({ key: "next_week", label: "Next week", day: ymd(startNextWeek), kind: "next_week" });
  sections.push({ key: "next_month", label: "Next month", day: ymd(firstOfNextMonth), kind: "next_month" });

  const endThisWeekYmd = ymd(addDays(today, daySlotCount));
  const startBeyondYmd = ymd(startBeyond);

  const classify = (day: string | null): string => {
    if (day == null) return "general";
    if (day <= todayYmd) return "today"; // today + anything overdue
    if (day <= endThisWeekYmd) return `day:${day}`;
    if (day < startBeyondYmd) return "next_week";
    return "next_month";
  };

  return { todayYmd, sections, classify };
}

// ── server-facing coarse bucket (legacy agent hint) ──────────────────────────

/** Map a scheduledDay to the coarse agent bucket vocabulary. */
export function coarseBucket(day: string | null, now = new Date()): string {
  if (!day) return "general";
  const today = ymd(startOfDay(now));
  if (day <= today) return "today";
  const tomorrow = ymd(addDays(startOfDay(now), 1));
  if (day === tomorrow) return "tomorrow";
  const inAWeek = ymd(addDays(startOfDay(now), 7));
  if (day <= inAWeek) return "next_week";
  return "next_month";
}

/** Map a coarse bucket name to a scheduledDay (used to backfill agent/legacy input). */
export function dayFromBucket(bucket: string | undefined | null, now = new Date()): string | null {
  const today = startOfDay(now);
  switch (bucket) {
    case "today":
      return ymd(today);
    case "tomorrow":
      return ymd(addDays(today, 1));
    case "next_week":
      return ymd(addDays(today, 7));
    case "next_month":
      return ymd(new Date(today.getFullYear(), today.getMonth() + 1, 1));
    case "general":
      return null;
    default:
      return ymd(today);
  }
}
