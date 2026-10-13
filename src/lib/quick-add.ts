// Quick-add parser — one line of natural text → a task.
//
//   "Call the bank tomorrow !high #Personal"
//   "לקבוע תור לרופא מחר"
//   "Ship v2 next friday @KWS Homelab"
//
// Pure and timezone-naive on purpose: it works in local calendar days and the
// caller passes `now`. Hebrew and English date words are both understood; a
// board is matched by `#name` / `@name` (prefix, case-insensitive) or by a
// trailing "to <board>" / "ל<board>". Everything recognised is stripped from
// the title; anything we don't understand stays as plain text.

import { ymd, addDays, startOfDay, parseYmd } from "./notes-schedule";
import type { Priority } from "./constants";

export type QuickAddBoard = { id: string; name: string; slug: string };

export type QuickAddResult = {
  title: string;
  /** Local "YYYY-MM-DD", or null for "no day" (inbox). */
  day: string | null;
  priority: Priority | null;
  board: QuickAddBoard | null;
  /** Human chips describing what was understood, for the live preview. */
  hints: string[];
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, "ראשון": 0, "יום ראשון": 0,
  mon: 1, monday: 1, "שני": 1, "יום שני": 1,
  tue: 2, tues: 2, tuesday: 2, "שלישי": 2, "יום שלישי": 2,
  wed: 3, weds: 3, wednesday: 3, "רביעי": 3, "יום רביעי": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, "חמישי": 4, "יום חמישי": 4,
  fri: 5, friday: 5, "שישי": 5, "יום שישי": 5,
  sat: 6, saturday: 6, "שבת": 6,
};

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: "urgent", asap: "urgent", "דחוף": "urgent",
  high: "high", important: "high", "חשוב": "high",
  medium: "medium", med: "medium", "בינוני": "medium",
  low: "low", "נמוך": "low",
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function dayFromWeekday(target: number, now: Date, nextWeek: boolean): string {
  const today = startOfDay(now);
  let delta = (target - today.getDay() + 7) % 7;
  if (delta === 0) delta = 7; // "friday" said on a Friday means next Friday
  if (nextWeek && delta < 7) delta += 0; // "next friday" = the coming one after this week's; keep simple
  return ymd(addDays(today, delta));
}

/** Try to read a date phrase from `text`; returns the day and the matched span. */
function matchDate(text: string, now: Date): { day: string | null; match: RegExpMatchArray } | null {
  const today = startOfDay(now);
  const tests: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/(?:^|\s)(today|tod|היום)(?=\s|$)/i, () => ymd(today)],
    [/(?:^|\s)(tomorrow|tmr|tmrw|מחר)(?=\s|$)/i, () => ymd(addDays(today, 1))],
    [/(?:^|\s)(day after tomorrow|מחרתיים)(?=\s|$)/i, () => ymd(addDays(today, 2))],
    [/(?:^|\s)(next week|שבוע הבא|בשבוע הבא)(?=\s|$)/i, () => ymd(addDays(today, 7))],
    [/(?:^|\s)(next month|חודש הבא|בחודש הבא)(?=\s|$)/i, () => ymd(new Date(today.getFullYear(), today.getMonth() + 1, 1))],
    [/(?:^|\s)(someday|later|no date|מתישהו|אין תאריך)(?=\s|$)/i, () => null],
    [/(?:^|\s)in (\d{1,2}) days?(?=\s|$)/i, (m) => ymd(addDays(today, Number(m[1])))],
    [/(?:^|\s)בעוד (\d{1,2}) ימים(?=\s|$)/i, (m) => ymd(addDays(today, Number(m[1])))],
    [/(?:^|\s)in (\d{1,2}) weeks?(?=\s|$)/i, (m) => ymd(addDays(today, 7 * Number(m[1])))],
    [/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/, (m) => (isNaN(parseYmd(m[1]).getTime()) ? null : m[1])],
    // 14/10 or 14.10 (day/month, local convention)
    [/(?:^|\s)(\d{1,2})[./](\d{1,2})(?=\s|$)/, (m) => {
      const d = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[1]));
      if (isNaN(d.getTime())) return null;
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return ymd(d);
    }],
  ];
  for (const [re, fn] of tests) {
    const m = text.match(re);
    if (m) return { day: fn(m), match: m };
  }
  // weekdays — longest names first so "יום שלישי" wins over "שלישי"
  const names = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?:^|\\s)(?:(next|ב|ביום)\\s*)?(${names.map(esc).join("|")})(?=\\s|$)`, "i");
  const m = text.match(re);
  if (m) {
    const name = m[2].toLowerCase();
    return { day: dayFromWeekday(WEEKDAYS[name], now, m[1]?.toLowerCase() === "next"), match: m };
  }
  return null;
}

function stripSpan(text: string, m: RegExpMatchArray): string {
  const idx = m.index ?? 0;
  return (text.slice(0, idx) + " " + text.slice(idx + m[0].length)).replace(/\s+/g, " ").trim();
}

function findBoard(token: string, boards: QuickAddBoard[]): QuickAddBoard | null {
  const t = token.toLowerCase().replace(/[-_]/g, " ");
  if (!t) return null;
  const norm = (b: QuickAddBoard) => b.name.toLowerCase().replace(/[-_]/g, " ");
  return (
    boards.find((b) => norm(b) === t) ??
    boards.find((b) => norm(b).startsWith(t)) ??
    boards.find((b) => norm(b).split(" ").some((w) => w.startsWith(t))) ??
    null
  );
}

export function parseQuickAdd(input: string, boards: QuickAddBoard[] = [], now = new Date()): QuickAddResult {
  let text = input.replace(/\s+/g, " ").trim();
  const hints: string[] = [];
  let priority: Priority | null = null;
  let board: QuickAddBoard | null = null;
  let day: string | null | undefined; // undefined = not mentioned

  // Priority: "!high" anywhere, or a bare priority word at the end.
  const pr = text.match(/(?:^|\s)!(urgent|high|medium|med|low|דחוף|חשוב)(?=\s|$)/i) ?? text.match(/\s(urgent|asap|דחוף)$/i);
  if (pr) {
    priority = PRIORITY_WORDS[pr[1].toLowerCase()] ?? null;
    text = stripSpan(text, pr);
  }

  // Board: "#name" / "@name" — multi-word boards are matched greedily by prefix
  // ("#kws homelab" → KWS Homelab) by trying the longest token run first.
  const tag = text.match(/(?:^|\s)[#@]([^\s#@!]+(?:\s+[^\s#@!]+)*)/);
  if (tag) {
    const words = tag[1].split(" ");
    for (let n = Math.min(words.length, 4); n >= 1 && !board; n--) {
      const candidate = words.slice(0, n).join(" ");
      const b = findBoard(candidate, boards);
      if (b) {
        board = b;
        const idx = (tag.index ?? 0) + tag[0].indexOf(tag[1]) - 1; // include the sigil
        text = (text.slice(0, idx) + " " + text.slice(idx + 1 + candidate.length)).replace(/\s+/g, " ").trim();
      }
    }
  }

  // Date words.
  const d = matchDate(text, now);
  if (d) {
    day = d.day;
    text = stripSpan(text, d.match);
  }

  // Trailing "to <board>" / "ל<board>" as a softer board hint.
  if (!board) {
    const to = text.match(/\s(?:to|into|in|ב|ל)\s?([^\s].{1,40})$/i);
    if (to) {
      const b = findBoard(to[1], boards);
      if (b && b.name.length >= 3) {
        board = b;
        text = text.slice(0, to.index).trim();
      }
    }
  }

  const title = text.replace(/^[-•*]\s*/, "").trim();
  if (day === undefined) day = null;

  if (day) {
    const today = ymd(startOfDay(now));
    const tomorrow = ymd(addDays(startOfDay(now), 1));
    hints.push(day === today ? "Today" : day === tomorrow ? "Tomorrow" : parseYmd(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
  }
  if (priority) hints.push(priority[0].toUpperCase() + priority.slice(1));
  if (board) hints.push(board.name);

  return { title: title || input.trim(), day, priority, board, hints };
}
