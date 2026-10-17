import { z } from "zod";
import { nanoid } from "nanoid";
import { handler, ok, created, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { db } from "@/lib/db";
import { MAX_CALENDAR_FEEDS, parseUserSettings, type CalendarFeed, type UserSettings } from "@/lib/user-settings";
import { FEED_COLORS, feedHost, normalizeFeedUrl, probeFeed } from "@/lib/services/calendar-feeds";

export const dynamic = "force-dynamic";

/** What the browser may know about a feed: never the secret URL, only its host. */
const publicFeed = (f: CalendarFeed) => ({ id: f.id, name: f.name, color: f.color, host: feedHost(f.url) });

async function freshSettings(userId: string): Promise<UserSettings> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { settings: true } });
  return parseUserSettings(u?.settings);
}

async function saveFeeds(userId: string, settings: UserSettings, feeds: CalendarFeed[]) {
  await db.user.update({ where: { id: userId }, data: { settings: JSON.stringify({ ...settings, calendarFeeds: feeds }) } });
}

export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  return ok({ feeds: parseUserSettings(ctx.user.settings).calendarFeeds.map(publicFeed) });
});

const addSchema = z.object({ url: z.string().trim().min(8).max(2000), name: z.string().trim().max(60).optional() });

/** Add a feed: validated by fetching it once; named after the calendar unless a name is given. */
export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const input = parse(addSchema, await readJson(req));
  const url = normalizeFeedUrl(input.url);
  const settings = await freshSettings(ctx.user.id);
  if (settings.calendarFeeds.length >= MAX_CALENDAR_FEEDS) throw new HttpError(422, `Up to ${MAX_CALENDAR_FEEDS} calendars.`);
  if (settings.calendarFeeds.some((f) => f.url === url)) throw new HttpError(409, "That calendar is already added.");
  const probe = await probeFeed(url);
  const used = new Set(settings.calendarFeeds.map((f) => f.color));
  const feed: CalendarFeed = {
    id: nanoid(10),
    url,
    name: input.name || probe.name || "Calendar",
    color: FEED_COLORS.find((c) => !used.has(c)) ?? FEED_COLORS[settings.calendarFeeds.length % FEED_COLORS.length],
  };
  const feeds = [...settings.calendarFeeds, feed];
  await saveFeeds(ctx.user.id, settings, feeds);
  return created({ feed: publicFeed(feed), feeds: feeds.map(publicFeed) });
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60).optional(),
  color: z.enum(FEED_COLORS).optional(),
});

export const PATCH = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const input = parse(patchSchema, await readJson(req));
  const settings = await freshSettings(ctx.user.id);
  if (!settings.calendarFeeds.some((f) => f.id === input.id)) throw new HttpError(404, "Calendar not found");
  const feeds = settings.calendarFeeds.map((f) =>
    f.id === input.id ? { ...f, ...(input.name ? { name: input.name } : {}), ...(input.color ? { color: input.color } : {}) } : f,
  );
  await saveFeeds(ctx.user.id, settings, feeds);
  return ok({ feeds: feeds.map(publicFeed) });
});

export const DELETE = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const id = new URL(req.url).searchParams.get("id");
  const settings = await freshSettings(ctx.user.id);
  const feeds = settings.calendarFeeds.filter((f) => f.id !== id);
  if (feeds.length === settings.calendarFeeds.length) throw new HttpError(404, "Calendar not found");
  await saveFeeds(ctx.user.id, settings, feeds);
  return ok({ feeds: feeds.map(publicFeed) });
});
