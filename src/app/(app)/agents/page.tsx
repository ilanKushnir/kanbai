import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { AgentsView } from "@/components/agents/agents-view";
import type { AgentFull } from "@/lib/types";
import { listActivity } from "@/lib/services/activity-feed";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const ctx = await getContext();
  if (!ctx.isManager) redirect("/today"); // agent management is owner/admin-only

  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "asc" },
  });

  // Workspace members an agent can be owned by (owner caps its board access).
  const members = (
    await db.workspaceMember.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    })
  ).map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role }));

  const data: AgentFull[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    color: a.color,
    status: a.status,
    ownerUserId: a.ownerUserId,
    apiKeyPrefix: a.apiKeyPrefix,
    apiKeyLast4: a.apiKeyLast4,
    hasKey: !!a.apiKeyPrefix,
    scopes: a.scopes.split(",").filter(Boolean),
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }));

  const activity = await listActivity({ workspaceId: ctx.workspace.id, limit: 40, actorType: "agent" }).catch(() => []);

  return <AgentsView agents={data} members={members} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} activity={activity} />;
}
