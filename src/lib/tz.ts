// Calendar-day helpers for a fixed IANA timezone. The server may run in UTC
// (Docker) while the workspace lives in Asia/Jerusalem; "today" must follow the
// workspace, not the host. Pure Intl — no deps, safe on client and server.

export const DEFAULT_TZ = "Asia/Jerusalem";

/** The workspace timezone: env KANBAI_TZ, else Asia/Jerusalem. */
export function workspaceTz(): string {
  const tz = process.env.KANBAI_TZ?.trim();
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The "YYYY-MM-DD" calendar day of an instant, in `tz`. */
export function ymdInTz(date: Date, tz: string = workspaceTz()): string {
  const parts = fmt(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's "YYYY-MM-DD" in `tz` (optionally for a given "now"). */
export function todayYmd(tz: string = workspaceTz(), now: Date = new Date()): string {
  return ymdInTz(now, tz);
}

/** Shift a "YYYY-MM-DD" by `n` calendar days (pure calendar math, no tz drift). */
export function addDaysYmd(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, (m || 1) - 1, (d || 1) + n);
  return new Date(t).toISOString().slice(0, 10);
}

/** The UTC offset (minutes east of UTC) that `tz` has at the given instant. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * The instant at `hh:mm` local time on calendar day `day` in `tz`.
 * Two-pass offset resolution handles DST transitions correctly.
 */
export function zonedTime(day: string, hour: number, minute: number, tz: string = workspaceTz()): Date {
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y, (m || 1) - 1, d || 1, hour, minute, 0, 0);
  let guess = new Date(naive - tzOffsetMinutes(new Date(naive), tz) * 60_000);
  const off2 = tzOffsetMinutes(guess, tz);
  guess = new Date(naive - off2 * 60_000);
  return guess;
}

/** Start of the calendar day `day` in `tz` as an instant. */
export function startOfDayInTz(day: string, tz: string = workspaceTz()): Date {
  return zonedTime(day, 0, 0, tz);
}

/** The instant one day after start-of-day — an exclusive upper bound. */
export function endOfDayInTz(day: string, tz: string = workspaceTz()): Date {
  return startOfDayInTz(addDaysYmd(day, 1), tz);
}
