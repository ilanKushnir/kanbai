import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { generateApiKey } from "@/lib/crypto";
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
