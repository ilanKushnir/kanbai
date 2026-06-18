export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

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
  "comments:write",
  "members:read",
  "members:write",
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export const WEBHOOK_EVENTS = [
  "note.queued", // a note was sent to this agent to sort
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
