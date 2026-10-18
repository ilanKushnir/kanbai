import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { resolveWorkspaceUserId } from "@/lib/services/notes";
import { agentCalendar } from "@/lib/services/calendar-feeds";
import { addDaysYmd, todayYmd, workspaceTz } from "@/lib/tz";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/v1/calendar[?day=today|tomorrow|YYYY-MM-DD | ?from=&to=]
 *
 * The person's own calendar (the iCal links they added under Settings →
 * Calendars), read-only: `{ connected, timezone, from, to, events, errors }`.
 * Event times are already local to the workspace timezone. The person is the
 * agent's owner, else the workspace owner. Default: today.
 */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:read");
  const url = new URL(req.url);
  const tz = workspaceTz();
  const today = todayYmd(tz);
  const word = (d: string | null) => (d === "today" || d == null ? today : d === "tomorrow" ? addDaysYmd(today, 1) : d);
  const day = url.searchParams.get("day");
  const from = word(url.searchParams.get("from") ?? day);
  const to = word(url.searchParams.get("to") ?? day ?? from);
  if (!DAY.test(from) || !DAY.test(to) || to < from) throw new HttpError(422, "Use day=today|tomorrow|YYYY-MM-DD, or from/to as YYYY-MM-DD (from ≤ to)");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 31) throw new HttpError(422, "At most 31 days at a time");

  const userId = agent.ownerUserId ?? (await resolveWorkspaceUserId(agent.workspaceId, {}));
  const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const cal = await agentCalendar(user?.settings, from, to, tz);
  return ok({ ...cal, timezone: tz, from, to });
});
