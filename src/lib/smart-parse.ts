import type { Priority } from "./constants";

export type ParsedNote = {
  title: string;
  description: string;
  priority?: Priority;
  dueDate?: string | null; // ISO
  labels: string[];
};

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: "urgent",
  high: "high",
  med: "medium",
  medium: "medium",
  low: "low",
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function atNoon(d: Date) {
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Resolve an @token to an ISO date (noon, local), or null. */
function dueFromToken(token: string): string | null {
  const t = token.toLowerCase();
  const now = new Date();

  if (t === "today" || t === "tod") return atNoon(new Date()).toISOString();
  if (t === "tomorrow" || t === "tmr" || t === "tom") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return atNoon(d).toISOString();
  }
  if (t in WEEKDAYS) {
    const target = WEEKDAYS[t];
    const d = new Date();
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "next" occurrence, not today
    d.setDate(d.getDate() + delta);
    return atNoon(d).toISOString();
  }
  // ISO date YYYY-MM-DD
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!isNaN(d.getTime())) return atNoon(d).toISOString();
  }
  void now;
  return null;
}

/**
 * Parse a captured note into structured ticket fields.
 *   "Call bank @tomorrow !high #finance"  →  title "Call bank", high, due tmrw, [finance]
 * First line is the title (minus tokens); remaining lines become the description.
 */
export function parseSmartTokens(body: string): ParsedNote {
  const lines = body.replace(/\r/g, "").split("\n");
  const firstLine = lines[0] ?? "";
  const rest = lines.slice(1).join("\n").trim();

  let priority: Priority | undefined;
  let dueDate: string | null | undefined;
  const labels: string[] = [];

  // Labels can appear anywhere in the body.
  for (const m of body.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi)) {
    const name = m[1].toLowerCase();
    if (!labels.includes(name)) labels.push(name);
  }

  // Priority + due parsed from the first line.
  const prMatch = firstLine.match(/(?:^|\s)!(urgent|high|medium|med|low)\b/i);
  if (prMatch) priority = PRIORITY_WORDS[prMatch[1].toLowerCase()];

  for (const m of firstLine.matchAll(/(?:^|\s)@([a-z0-9-]+)/gi)) {
    const due = dueFromToken(m[1]);
    if (due) {
      dueDate = due;
      break;
    }
  }

  // Strip tokens from the title.
  const title = firstLine
    .replace(/(?:^|\s)!(urgent|high|medium|med|low)\b/gi, " ")
    .replace(/(?:^|\s)@[a-z0-9-]+/gi, " ")
    .replace(/(?:^|\s)#[a-z0-9][a-z0-9-]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || firstLine.trim() || "Untitled",
    description: rest,
    priority,
    dueDate,
    labels,
  };
}

/** True if the text contains any smart tokens worth previewing. */
export function hasSmartTokens(body: string): boolean {
  return /(?:^|\s)([!@#])[a-z0-9]/i.test(body);
}
