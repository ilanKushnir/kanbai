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

/**
 * The assignee list a card renders: the full multi-assign list when present,
 * falling back to the legacy single `assignee` (older serialized payloads),
 * else empty.
 */
export function cardAssignees<T>(ticket: { assignee?: T | null; assignees?: T[] | null }): T[] {
  if (ticket.assignees?.length) return ticket.assignees;
  return ticket.assignee ? [ticket.assignee] : [];
}

/**
 * Completion chip for tickets sitting in a done column — shown INSTEAD of the
 * due chip, so a finished ticket never reads "overdue". Falls back to a bare
 * "Done" for legacy rows completed before completedAt existed.
 */
export function completionMeta(completedAt: string | null | undefined): { label: string; tone: "emerald" } {
  if (!completedAt) return { label: "Done", tone: "emerald" };
  const d = new Date(completedAt);
  return {
    label: `Done ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    tone: "emerald",
  };
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
