import { db } from "./db";
import { hashApiKey } from "./crypto";
import { HttpError } from "./api";
import type { Scope } from "./constants";
import type { Agent } from "@/generated/prisma";

/**
 * Authenticate an inbound agent request via `Authorization: Bearer <api_key>`.
 * Returns the Agent or throws an HttpError (401/403).
 */
export async function requireAgent(req: Request): Promise<Agent> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, "Missing bearer token. Send 'Authorization: Bearer <api_key>'.", "no_token");
  }
  const key = match[1].trim();
  const agent = await db.agent.findUnique({ where: { apiKeyHash: hashApiKey(key) } });
  if (!agent) throw new HttpError(401, "Invalid API key.", "invalid_key");
  if (agent.status !== "active") throw new HttpError(403, "This agent is disabled.", "agent_disabled");

  // Touch last-seen without blocking the request.
  void db.agent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return agent;
}

export function requireScope(agent: Agent, scope: Scope) {
  const scopes = agent.scopes.split(",").map((s) => s.trim());
  if (!scopes.includes(scope)) {
    throw new HttpError(403, `Missing required scope: ${scope}`, "missing_scope");
  }
}
