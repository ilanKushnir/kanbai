import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { generateApiKey, generateWebhookSecret } from "@/lib/crypto";
import { dispatchWebhook } from "@/lib/webhooks";
import { ALL_SCOPES } from "@/lib/constants";
import { serializeWebhookStatus } from "@/lib/serialize";

export function serializeAgent(a: {
  id: string;
  name: string;
  kind: string;
  color: string;
  status: string;
  apiKeyPrefix: string | null;
  apiKeyLast4: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookActive: boolean;
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
    hasKey: !!a.apiKeyPrefix,
    apiKeyPrefix: a.apiKeyPrefix,
    apiKeyLast4: a.apiKeyLast4,
    webhookUrl: a.webhookUrl,
    hasSecret: !!a.webhookSecret,
    webhookActive: a.webhookActive,
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
    status: "active" | "disabled";
    scopes: string[];
  }>,
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl || null;
  if (input.webhookSecret !== undefined) data.webhookSecret = input.webhookSecret || null;
  if (input.webhookActive !== undefined) data.webhookActive = input.webhookActive;
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
  input: { url?: string | null; active?: boolean; secret?: string | null },
) {
  const data: Record<string, unknown> = {};
  if (input.url !== undefined) data.webhookUrl = input.url || null;
  if (input.active !== undefined) data.webhookActive = input.active;
  if (input.secret !== undefined) data.webhookSecret = input.secret || null;
  const agent = await db.agent.update({ where: { id: agentId }, data });
  return serializeWebhookStatus(agent);
}

/** Fire a "ping" (signed if a secret is set) so the agent/user can confirm webhook setup. */
export async function sendTestWebhook(agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new HttpError(404, "Agent not found");
  if (!agent.webhookUrl) throw new HttpError(422, "Set a webhook URL first");
  const deliveryId = await dispatchWebhook(agentId, "ping", {
    message: agent.webhookSecret
      ? "Hello from Kanbai 👋 — if you can verify this signature, you're wired up."
      : "Hello from Kanbai 👋 — your webhook is reachable (unsigned: no signing secret set).",
  });
  return { deliveryId };
}
