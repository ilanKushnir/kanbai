import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parseUserSettings } from "@/lib/user-settings";
import { loadEvents } from "@/lib/services/calendar-feeds";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 100;

/** GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD — the signed-in user's external calendar events. */
export const GET = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to) || to < from) throw new HttpError(422, "from and to must be YYYY-MM-DD days, from ≤ to");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new HttpError(422, `At most ${MAX_RANGE_DAYS} days at a time`);
  const { calendarFeeds } = parseUserSettings(ctx.user.settings);
  return ok(await loadEvents(calendarFeeds, from, to));
});
