import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { generateApiKey, generateWebhookSecret, secretFingerprint } from "@/lib/crypto";
import { dispatchWebhook, type DeliveryResult } from "@/lib/webhooks";
import { eventsToSpec } from "@/lib/webhook-events";
import { ALL_SCOPES, type WebhookEvent } from "@/lib/constants";
import { serializeWebhookStatus } from "@/lib/serialize";

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
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookActive: boolean;
  webhookEvents: string;
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
    webhookUrl: a.webhookUrl,
    hasSecret: !!a.webhookSecret,
    webhookActive: a.webhookActive,
    webhookEvents: a.webhookEvents,
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
      color: input.color ?? "#6d5dfb",
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      apiKeyLast4: key.last4,
      webhookSecret: generateWebhookSecret(),
      scopes: ALL_SCOPES.join(","),
    },
  });
  // Return the plaintext key exactly once.
  return { agent: serializeAgent(agent), apiKey: key.key };
}

export async function rotateApiKey(agentId: string) {
  const key = generateApiKey();
  await db.agent.update({
    where: { id: agentId },
    data: { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyLast4: key.last4 },
  });
  return { apiKey: key.key };
}

export async function regenerateSecret(agentId: string) {
  const secret = generateWebhookSecret();
  const agent = await db.agent.update({ where: { id: agentId }, data: { webhookSecret: secret } });
  return { secret, agent: serializeAgent(agent) };
}

export async function updateAgent(
  agentId: string,
  input: Partial<{
    name: string;
    webhookUrl: string | null;
    webhookSecret: string | null;
    webhookActive: boolean;
    webhookEvents: WebhookEvent[];
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
  if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl || null;
  if (input.webhookSecret !== undefined) data.webhookSecret = input.webhookSecret || null;
  if (input.webhookActive !== undefined) data.webhookActive = input.webhookActive;
  if (input.webhookEvents !== undefined) data.webhookEvents = eventsToSpec(input.webhookEvents);
  if (input.status !== undefined) data.status = input.status;
  if (input.scopes !== undefined) data.scopes = input.scopes.join(",");

  const agent = await db.agent.update({ where: { id: agentId }, data });
  return serializeAgent(agent);
}

export async function deleteAgent(agentId: string) {
  await db.agent.delete({ where: { id: agentId } });
}

/**
 * Self-setup: an agent registers/updates its own webhook with its bearer key.
 * `secret` semantics: undefined → keep current; "" or null → clear (unsigned);
 * a value → set it. Returns the resulting webhook status (never the secret).
 */
export async function setOwnWebhook(
  agentId: string,
  input: { url?: string | null; active?: boolean; secret?: string | null; events?: WebhookEvent[] },
) {
  const data: Record<string, unknown> = {};
  if (input.url !== undefined) data.webhookUrl = input.url || null;
  if (input.active !== undefined) data.webhookActive = input.active;
  if (input.secret !== undefined) data.webhookSecret = input.secret || null;
  if (input.events !== undefined) data.webhookEvents = eventsToSpec(input.events);
  const agent = await db.agent.update({ where: { id: agentId }, data });
  return serializeWebhookStatus(agent);
}

/**
 * Fire a "ping" (signed if a secret is set) and WAIT for the outcome, so the
 * caller can show exactly what the receiver answered — status code, its error
 * body, and the fingerprint of the secret Kanbai signed with. A 401 here
 * almost always means the receiver verifies with a DIFFERENT secret.
 */
export async function sendTestWebhook(agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new HttpError(404, "Agent not found");
  if (!agent.webhookUrl) throw new HttpError(422, "Set a webhook URL first");
  if (agent.status !== "active") throw new HttpError(422, "Agent is disabled — enable it to send a test");
  if (!agent.webhookActive) throw new HttpError(422, "Webhook deliveries are paused for this agent");
  const result = (await dispatchWebhook(
    agentId,
    "ping",
    {
      message: agent.webhookSecret
        ? "Hello from Kanbai 👋 — if you can verify this signature, you're wired up."
        : "Hello from Kanbai 👋 — your webhook is reachable (unsigned: no signing secret set).",
    },
    { wait: true },
  )) as DeliveryResult;
  return {
    result,
    // Never the secret itself — a short hash both sides can compare.
    secretFingerprint: agent.webhookSecret ? secretFingerprint(agent.webhookSecret) : null,
  };
}
