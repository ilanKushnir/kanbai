import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertAgentAccess } from "@/lib/access";
import { rotateApiKey } from "@/lib/services/agents";

export const POST = handler(
  async (_req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const { workspace } = await getCurrentContext();
    const { agentId } = await params;
    await assertAgentAccess(agentId, workspace.id);
    const result = await rotateApiKey(agentId);
    return ok(result); // { apiKey } — shown once
  },
);
