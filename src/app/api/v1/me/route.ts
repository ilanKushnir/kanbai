import { handler, ok } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { serializeAgentPublic } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  return ok({
    agent: serializeAgentPublic(agent),
    workspaceId: agent.workspaceId,
    scopes: agent.scopes.split(",").filter(Boolean),
  });
});
