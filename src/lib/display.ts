import { PRIORITY_META, type Priority } from "./constants";

export function priorityMeta(p: string) {
  return PRIORITY_META[(p as Priority)] ?? PRIORITY_META.none;
}

/** Human due label + urgency tone for chips. */
export function dueMeta(iso: string | null): { label: string; tone: "rose" | "amber" | "slate" | "emerald" } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);

  if (days < 0) return { label: days === -1 ? "Yesterday" : `${Math.abs(days)}d overdue`, tone: "rose" };
  if (days === 0) return { label: "Today", tone: "amber" };
  if (days === 1) return { label: "Tomorrow", tone: "amber" };
  if (days <= 6) return { label: `${days}d`, tone: "slate" };
  return {
    label: due.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    tone: "slate",
  };
}
