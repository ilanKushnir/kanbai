import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { dayPlanSchema, dayString } from "@/lib/validation";
import { setDayPlan } from "@/lib/services/day-plans";

/** PUT /api/day-plans/YYYY-MM-DD { items: [{ id, part }] } — how the viewer arranged that day on Today. */
export const PUT = handler(async (req: Request, { params }: { params: Promise<{ day: string }> }) => {
  const { user, workspace } = await getCurrentContext();
  const day = parse(dayString, (await params).day);
  const { items } = parse(dayPlanSchema, await readJson(req));
  const plan = await setDayPlan(user.id, workspace.id, day, items);
  return ok({ day, items: plan });
});
