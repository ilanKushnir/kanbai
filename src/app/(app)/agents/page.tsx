import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/auth";
import { AgentsView } from "@/components/agents/agents-view";
import type { AgentFull } from "@/lib/types";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { workspace } = await getCurrentContext();

  const agents = await db.agent.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 6 } },
  });

  const data: AgentFull[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    color: a.color,
    status: a.status,
    apiKeyPrefix: a.apiKeyPrefix,
    apiKeyLast4: a.apiKeyLast4,
    hasKey: !!a.apiKeyPrefix,
    webhookUrl: a.webhookUrl,
    webhookSecret: a.webhookSecret,
    webhookActive: a.webhookActive,
    scopes: a.scopes.split(",").filter(Boolean),
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    deliveries: a.deliveries.map((d) => ({
      id: d.id,
      event: d.event,
      status: d.status,
      statusCode: d.statusCode,
      signature: d.signature,
      error: d.error,
      attempts: d.attempts,
      createdAt: d.createdAt.toISOString(),
    })),
  }));

  return <AgentsView agents={data} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />;
}
