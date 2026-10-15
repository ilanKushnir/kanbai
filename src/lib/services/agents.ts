import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { generateApiKey, generateConnectCode, hashApiKey } from "@/lib/crypto";
import { ALL_SCOPES } from "@/lib/constants";

export function serializeAgent(a: {
  id: string;
  name: string;
  kind: string;
  color: string;
  status: string;
  ownerUserId: string | null;
  /** Included where owner context is displayed (assignee pickers/cards). */
  ownerUser?: { name: string } | null;
  apiKeyPrefix: string | null;
  apiKeyLast4: string | null;
  scopes: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    color: a.color,
    status: a.status,
    ownerUserId: a.ownerUserId,
    ownerName: a.ownerUser?.name ?? null,
    hasKey: !!a.apiKeyPrefix,
    apiKeyPrefix: a.apiKeyPrefix,
    apiKeyLast4: a.apiKeyLast4,
    scopes: a.scopes.split(",").filter(Boolean),
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function createAgent(
  workspaceId: string,
  input: { name: string; kind: string; color?: string },
) {
  const key = generateApiKey();
  const agent = await db.agent.create({
    data: {
      workspaceId,
      name: input.name,
      kind: input.kind,
      color: input.color ?? "#d63a0e",
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      apiKeyLast4: key.last4,
      scopes: ALL_SCOPES.join(","),
    },
  });
  const connect = await issueConnectCode(agent.id);
  // Return the plaintext key exactly once (manual setups); the brief uses `connect`.
  return { agent: serializeAgent(agent), apiKey: key.key, connect };
}

/** How long a connect code stays redeemable after it is issued. */
export const CONNECT_CODE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * After the first redemption the same code keeps working this long, so an
 * agent whose first attempt crashed before it stored the key can simply retry.
 * Every redemption mints a new key, so only the last one an agent receives works.
 */
export const CONNECT_RETRY_GRACE_MS = 10 * 60 * 1000;

/**
 * Issue a fresh one-time connect code for an agent (replacing any earlier one).
 * The agent's current key keeps working until the code is redeemed, so handing
 * out a new brief never breaks a running integration.
 */
export async function issueConnectCode(agentId: string, now = new Date()) {
  const { code, hash } = generateConnectCode();
  const expiresAt = new Date(now.getTime() + CONNECT_CODE_TTL_MS);
  await db.agent.update({
    where: { id: agentId },
    data: { connectCodeHash: hash, connectCodeExpiresAt: expiresAt, connectRedeemedAt: null },
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * Redeem a connect code: mint a new API key for the agent and return it.
 * Throws 401 for unknown/expired/spent codes and 403 for a disabled agent.
 */
export async function redeemConnectCode(code: string, now = new Date()) {
  const agent = code ? await db.agent.findUnique({ where: { connectCodeHash: hashApiKey(code.trim()) } }) : null;
  if (!agent || !agent.connectCodeExpiresAt) {
    throw new HttpError(401, "Unknown connect code. Ask the owner for a fresh brief (Agents → Connect).", "invalid_code");
  }
  const spent =
    agent.connectRedeemedAt && now.getTime() - agent.connectRedeemedAt.getTime() > CONNECT_RETRY_GRACE_MS;
  if (spent || agent.connectCodeExpiresAt.getTime() < now.getTime()) {
    throw new HttpError(401, "This connect code has expired. Ask the owner for a fresh brief (Agents → Connect).", "code_expired");
  }
  if (agent.status !== "active") throw new HttpError(403, "This agent is disabled.", "agent_disabled");

  const key = generateApiKey();
  const updated = await db.agent.update({
    where: { id: agent.id },
    data: {
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      apiKeyLast4: key.last4,
      connectRedeemedAt: agent.connectRedeemedAt ?? now,
      lastSeenAt: now,
    },
  });
  return { agent: updated, apiKey: key.key };
}

export async function rotateApiKey(agentId: string) {
  const key = generateApiKey();
  await db.agent.update({
    where: { id: agentId },
    // A manual rotation also voids any outstanding connect code.
    data: {
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      apiKeyLast4: key.last4,
      connectCodeHash: null,
      connectCodeExpiresAt: null,
      connectRedeemedAt: null,
    },
  });
  return { apiKey: key.key };
}

export async function updateAgent(
  agentId: string,
  input: Partial<{
    name: string;
    status: "active" | "disabled";
    scopes: string[];
    ownerUserId: string | null;
  }>,
) {
  const data: Record<string, unknown> = {};
  if (input.ownerUserId !== undefined) {
    // The owning user caps the agent's board access to their own — they must
    // belong to the agent's workspace. null returns the agent to workspace-wide.
    if (input.ownerUserId) {
      const existing = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
      if (!existing) throw new HttpError(404, "Agent not found");
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: existing.workspaceId, userId: input.ownerUserId },
        select: { id: true },
      });
      if (!member) throw new HttpError(422, "Owner must be a member of this workspace");
    }
    data.ownerUserId = input.ownerUserId || null;
  }
  if (input.name !== undefined) data.name = input.name;
  if (input.status !== undefined) data.status = input.status;
  if (input.scopes !== undefined) data.scopes = input.scopes.join(",");

  const agent = await db.agent.update({ where: { id: agentId }, data });
  return serializeAgent(agent);
}

export async function deleteAgent(agentId: string) {
  await db.agent.delete({ where: { id: agentId } });
}
