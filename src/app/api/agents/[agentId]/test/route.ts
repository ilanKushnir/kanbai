import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertAgentInWorkspace } from "@/lib/access";
import { sendTestWebhook } from "@/lib/services/agents";

export const POST = handler(
  async (_req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { agentId } = await params;
    await assertAgentInWorkspace(agentId, ctx.workspace.id);
    const result = await sendTestWebhook(agentId);
    return ok(result);
  },
);
