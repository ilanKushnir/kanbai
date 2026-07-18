import { PRIORITY_META, type Priority } from "./constants";

export function priorityMeta(p: string) {
  return PRIORITY_META[(p as Priority)] ?? PRIORITY_META.none;
}

/**
 * Whether `userId` may assign tickets to this agent: owned agents belong to
 * their owner alone; ownerless workspace agents are assignable by anyone.
 * Pickers filter with this — the server enforces the same rule.
 */
export function canAssignAgent(agent: { ownerUserId?: string | null }, userId?: string | null): boolean {
  return !agent.ownerUserId || agent.ownerUserId === userId;
}

/**
 * Assignee display label with owner context for user-owned agents
 * ("Hermes · Yuval"); humans and workspace agents are just their name.
 */
export function assigneeLabel(assignee: { type: "user" | "agent"; name: string; ownerName?: string | null }): string {
  return assignee.type === "agent" && assignee.ownerName
    ? `${assignee.name} · ${assignee.ownerName}`
    : assignee.name;
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
