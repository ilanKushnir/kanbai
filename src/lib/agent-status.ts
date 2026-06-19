// Client-safe derivation of an agent's live connection state from its
// enable flag (`status`) and the last time it made an authenticated call
// (`lastSeenAt`, bumped on every /api/v1 request). "Active" (green) means the
// agent has actually communicated recently — not merely that it was created.

export type AgentConnectionState = "online" | "idle" | "waiting" | "disabled";

export type AgentConnection = {
  state: AgentConnectionState;
  label: string;
  tone: string; // Badge tone key
};

/** An agent counts as online if it called in within this window. */
export const AGENT_ONLINE_MS = 5 * 60 * 1000;

export function agentConnection(
  agent: { status: string; lastSeenAt: string | null },
  now: number,
): AgentConnection {
  if (agent.status !== "active") return { state: "disabled", label: "Disabled", tone: "slate" };
  if (!agent.lastSeenAt) return { state: "waiting", label: "Not connected", tone: "slate" };
  const age = now - new Date(agent.lastSeenAt).getTime();
  if (age <= AGENT_ONLINE_MS) return { state: "online", label: "Active", tone: "emerald" };
  return { state: "idle", label: "Idle", tone: "amber" };
}
