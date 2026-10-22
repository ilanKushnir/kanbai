import { db } from "@/lib/db";
import { parsePlan, type DayPlans, type PlanEntry } from "@/lib/day-plan";

/** Plans older than this are dropped on the next write — a day's order matters around that day. */
const KEEP_DAYS = 14;

/** The person's plans for these days (days without one are left out). */
export async function getDayPlans(userId: string, workspaceId: string, days: string[]): Promise<DayPlans> {
  const rows = await db.dayPlan.findMany({ where: { userId, workspaceId, day: { in: days } }, select: { day: true, items: true } });
  return Object.fromEntries(rows.map((r) => [r.day, parsePlan(r.items)]));
}

/** Replace a day's plan (the client always sends the whole day). */
export async function setDayPlan(userId: string, workspaceId: string, day: string, items: PlanEntry[]): Promise<PlanEntry[]> {
  const clean = parsePlan(items);
  const json = JSON.stringify(clean);
  await db.dayPlan.upsert({
    where: { userId_workspaceId_day: { userId, workspaceId, day } },
    create: { userId, workspaceId, day, items: json },
    update: { items: json },
  });
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await db.dayPlan.deleteMany({ where: { userId, workspaceId, day: { lt: cutoff } } });
  return clean;
}
