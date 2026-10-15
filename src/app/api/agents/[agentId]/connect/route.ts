import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertAgentInWorkspace } from "@/lib/access";
import { issueConnectCode } from "@/lib/services/agents";

/** Issue a fresh one-time connect code (the brief). The current key keeps working until it's redeemed. */
export const POST = handler(
  async (_req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { agentId } = await params;
    await assertAgentInWorkspace(agentId, ctx.workspace.id);
    return ok({ connect: await issueConnectCode(agentId) });
  },
);
