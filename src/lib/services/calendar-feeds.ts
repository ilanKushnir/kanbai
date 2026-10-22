import ICAL from "ical.js";
import { HttpError } from "@/lib/api";
import { parseUserSettings, type CalendarFeed } from "@/lib/user-settings";
import { addDaysYmd } from "@/lib/tz";

/**
 * Read-only external calendars (Google's "secret address in iCal format",
 * iCloud, Outlook…) overlaid on Plan. The server fetches and expands the feed —
 * recurring events, exceptions and time zones — so the browser only ever sees
 * events in a range, never the secret URL.
 */

export type CalendarEvent = {
  id: string;
  feedId: string;
  title: string;
  allDay: boolean;
  /** All-day: first and last local day ("YYYY-MM-DD", inclusive). */
  startDay?: string;
  endDay?: string;
  /** Timed: ISO instants. */
  start?: string;
  end?: string;
  location?: string;
};

export const FEED_COLORS = ["blue", "emerald", "amber", "rose", "violet", "aqua", "iris", "slate"] as const;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_OCCURRENCES = 1500;

/** A private/loopback address literal — the server must not be pointed at its own network. */
function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::";
  return false;
}

/** webcal:// → https://; only public https URLs are accepted. */
export function normalizeFeedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new HttpError(422, "That doesn't look like a calendar link.", "invalid_feed_url");
  }
  if (url.protocol !== "https:") throw new HttpError(422, "Calendar links must start with https:// (or webcal://).", "invalid_feed_url");
  if (isPrivateHost(url.hostname)) throw new HttpError(422, "That address isn't reachable from KanbAi.", "invalid_feed_url");
  return url.toString();
}

/** Host only — what the UI may show about a feed. */
export function feedHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const cache = new Map<string, { at: number; text: string }>();

async function fetchFeedText(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "text/calendar, */*", "User-Agent": "KanbAi calendar sync" },
    redirect: "follow",
  }).catch(() => {
    throw new HttpError(502, "Couldn't reach the calendar.", "feed_unreachable");
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new HttpError(422, "The calendar link was refused — it may have been reset. Copy a fresh one.", "feed_refused");
  }
  if (!res.ok) throw new HttpError(502, `The calendar answered ${res.status}.`, "feed_unreachable");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new HttpError(422, "That calendar is too large.", "feed_too_large");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new HttpError(422, "That calendar is too large.", "feed_too_large");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new HttpError(422, "That link isn't an iCal calendar.", "feed_not_ical");
  cache.set(url, { at: Date.now(), text });
  return text;
}

function parseCalendar(text: string): ICAL.Component {
  try {
    const comp = new ICAL.Component(ICAL.parse(text));
    // Feeds carry their own zone definitions; register them so TZID times convert.
    for (const tz of comp.getAllSubcomponents("vtimezone")) {
      try {
        ICAL.TimezoneService.register(tz);
      } catch {
        /* a malformed zone falls back to floating time */
      }
    }
    return comp;
  } catch {
    throw new HttpError(422, "That calendar couldn't be read.", "feed_not_ical");
  }
}

/** The calendar's own display name (X-WR-CALNAME), for naming a new feed. */
export function calendarName(comp: ICAL.Component): string | null {
  const name = comp.getFirstPropertyValue("x-wr-calname");
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;
}

/** Fetch a feed once to validate it; returns its name and event count. */
export async function probeFeed(url: string): Promise<{ name: string | null; events: number }> {
  const comp = parseCalendar(await fetchFeedText(url));
  return { name: calendarName(comp), events: comp.getAllSubcomponents("vevent").length };
}

const dayOf = (t: ICAL.Time) => t.toString().slice(0, 10);

function toEvent(feedId: string, uid: string, summary: string | null, location: string | null, start: ICAL.Time, end: ICAL.Time | null): CalendarEvent {
  const title = (summary ?? "").trim() || "(busy)";
  const base = { id: `${feedId}:${uid}:${start.toString()}`, feedId, title, ...(location ? { location } : {}) };
  if (start.isDate) {
    // DTEND is exclusive for all-day events.
    const last = end ? end.clone() : start.clone();
    if (end) last.adjust(-1, 0, 0, 0);
    const endDay = last.compare(start) < 0 ? dayOf(start) : dayOf(last);
    return { ...base, allDay: true, startDay: dayOf(start), endDay };
  }
  const s = start.toJSDate();
  const e = end ? end.toJSDate() : s;
  return { ...base, allDay: false, start: s.toISOString(), end: e.toISOString() };
}

/**
 * Events of one calendar overlapping [from, to] (local days, inclusive):
 * single events, every occurrence of recurring ones (with moved/cancelled
 * exceptions applied); cancelled events are skipped.
 */
export function expandEvents(comp: ICAL.Component, feedId: string, from: string, to: string): CalendarEvent[] {
  const rangeStart = ICAL.Time.fromDateString(from);
  const rangeEnd = ICAL.Time.fromDateString(to);
  rangeEnd.adjust(1, 0, 0, 0); // exclusive end
  const startMs = rangeStart.toJSDate().getTime() - 86_400_000; // a day of slack for zone offsets
  const endMs = rangeEnd.toJSDate().getTime() + 86_400_000;

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of comp.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(v);
    if (!ev.uid || !ev.startDate) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else masters.set(`${ex.uid}#${ex.recurrenceId?.toString()}`, ex);
  }

  const cancelled = (c: ICAL.Component) => String(c.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
  const overlaps = (s: ICAL.Time, e: ICAL.Time | null) => {
    const sMs = s.toJSDate().getTime();
    const eMs = (e ?? s).toJSDate().getTime();
    return sMs < endMs && Math.max(eMs, sMs + 1) > startMs;
  };

  const out: CalendarEvent[] = [];
  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      if (cancelled(ev.component) || !overlaps(ev.startDate, ev.endDate)) continue;
      out.push(toEvent(feedId, ev.uid, ev.summary, ev.location, ev.startDate, ev.endDate));
      continue;
    }
    const it = ev.iterator();
    for (let next = it.next(), n = 0; next && n < MAX_OCCURRENCES; next = it.next(), n++) {
      if (next.toJSDate().getTime() >= endMs) break;
      const occ = ev.getOccurrenceDetails(next);
      if (cancelled(occ.item.component) || !overlaps(occ.startDate, occ.endDate)) continue;
      out.push(toEvent(feedId, ev.uid, occ.item.summary, occ.item.location, occ.startDate, occ.endDate));
    }
  }
  return out;
}

/** Every feed's events in range. A broken feed reports an error instead of failing the rest. */
export async function loadEvents(feeds: CalendarFeed[], from: string, to: string) {
  const results = await Promise.all(
    feeds.map(async (f) => {
      try {
        const comp = parseCalendar(await fetchFeedText(f.url));
        return { events: expandEvents(comp, f.id, from, to), error: null };
      } catch (e) {
        return { events: [], error: { feedId: f.id, name: f.name, message: e instanceof Error ? e.message : "Couldn't load" } };
      }
    }),
  );
  return {
    events: results.flatMap((r) => r.events),
    errors: results.flatMap((r) => (r.error ? [r.error] : [])),
  };
}

/** Test seam: forget cached feed bodies. */
export function clearFeedCache() {
  cache.clear();
}

/**
 * A person's calendar for agents: their feeds' events between two local days,
 * with times already in the workspace timezone ("09:30") and in order — all-day
 * first, then by start. `connected` is false when they linked no calendar.
 */
export async function agentCalendar(settingsRaw: string | null | undefined, from: string, to: string, tz: string) {
  const { calendarFeeds } = parseUserSettings(settingsRaw);
  if (!calendarFeeds.length) return { connected: false, events: [], errors: [] };
  // A day of margin each side: the expansion works in server days, the answer in workspace days.
  const { events, errors } = await loadEvents(calendarFeeds, addDaysYmd(from, -1), addDaysYmd(to, 1));
  const names = new Map(calendarFeeds.map((f) => [f.id, f.name]));
  const hm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const out = events
    .map((e) => ({
      title: e.title,
      calendar: names.get(e.feedId) ?? null,
      allDay: e.allDay,
      day: e.allDay ? e.startDay ?? null : e.start ? day(e.start) : null,
      endDay: e.allDay ? e.endDay ?? e.startDay ?? null : e.end ? day(e.end) : null,
      start: e.allDay ? null : e.start ? hm(e.start) : null,
      end: e.allDay ? null : e.end ? hm(e.end) : null,
      startsAt: e.start ?? null,
      location: e.location ?? null,
    }))
    .filter((e) => e.day != null && e.day <= to && (e.endDay ?? e.day) >= from)
    .sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : (a.startsAt ?? "").localeCompare(b.startsAt ?? "")));
  return { connected: true, events: out, errors: errors.map((e) => ({ calendar: e.name, message: e.message })) };
}
