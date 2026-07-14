export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const NOTE_BUCKETS = ["today", "tomorrow", "next_week", "next_month", "general"] as const;
export type NoteBucket = (typeof NOTE_BUCKETS)[number];
export const BUCKET_LABEL: Record<NoteBucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  next_week: "Next week",
  next_month: "Next month",
  general: "General",
};

export const AGENT_KINDS = ["hermes", "openclaw", "claudecode", "codex", "custom"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_META: Record<
  AgentKind,
  { label: string; color: string; blurb: string }
> = {
  hermes: { label: "Hermes", color: "#6d5dfb", blurb: "Primary orchestration agent" },
  openclaw: { label: "Open Claw", color: "#f59e0b", blurb: "Autonomous task runner" },
  claudecode: { label: "Claude Code", color: "#d97757", blurb: "Coding & repo agent" },
  codex: { label: "Codex", color: "#10a37f", blurb: "Code generation agent" },
  custom: { label: "Custom", color: "#64748b", blurb: "Any agent speaking the Kanbai protocol" },
};

export const ALL_SCOPES = [
  "boards:read",
  "boards:write",
  "tickets:read",
  "tickets:write",
  "inbox:read",
  "inbox:write",
  "notes:read",
  "notes:write",
  "comments:write",
  "members:read",
  "members:write",
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

/** Service identity advertised to agents via GET /api/v1/me. */
export const SERVICE_NAME = "Kanbai";
export const API_VERSION = "v1";

/**
 * Capabilities the Kanbai agent API exposes, independent of any one agent's
 * granted scopes. Reported by GET /api/v1/me so an agent can discover what the
 * service supports (resources to drive, webhook self-setup, optional signing)
 * without scraping the docs. Per-agent permissions are conveyed by `scopes`.
 */
export const AGENT_CAPABILITIES = {
  resources: ["boards", "tickets", "inbox", "notes", "comments", "members", "trash"],
  lifecycle: {
    // Full status management: PATCH columnId/subState, POST /tickets/:id/move,
    // and the one-call POST /tickets/:id/done (board's done column).
    ticketDone: true,
    // Notes: PATCH doneOn (complete/un-complete), scheduledDay (sort into a
    // day/section), status inbox|archived, priority, pinned.
    noteDone: true,
    // DELETE tickets/notes soft-deletes into a 30-day restorable trash;
    // GET/POST /api/v1/trash lists and restores. Permanent purge is human-only.
    softDelete: true,
    trashRestore: true,
  },
  webhook: {
    selfRegister: true, // POST /api/v1/agent/webhook with the agent's bearer key
    test: true, // POST /api/v1/agent/webhook/test fires a ping to itself
    signing: "optional", // HMAC SHA-256 — recommended, not required
  },
} as const;

export const WEBHOOK_EVENTS = [
  "note.queued", // a note was sent to this agent to sort
  "note.sorted", // a queued note was filed into a ticket — the agent can stop polling it
  "ticket.created",
  "ticket.updated",
  "ticket.moved",
  "ticket.assigned",
  "comment.created",
  "ping",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const LABEL_COLORS = [
  "slate", "iris", "aqua", "emerald", "amber", "rose", "violet", "blue",
] as const;

export const BOARD_COLORS = ["iris", "aqua", "emerald", "amber", "rose", "violet", "blue", "slate"] as const;

export const PRIORITY_META: Record<Priority, { label: string; color: string; rank: number }> = {
  none: { label: "None", color: "var(--color-fg-subtle)", rank: 0 },
  low: { label: "Low", color: "#64748b", rank: 1 },
  medium: { label: "Medium", color: "#2f8fed", rank: 2 },
  high: { label: "High", color: "#f59e0b", rank: 3 },
  urgent: { label: "Urgent", color: "#e23d59", rank: 4 },
};
