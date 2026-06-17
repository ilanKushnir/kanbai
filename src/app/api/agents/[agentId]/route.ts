import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertAgentInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateAgentSchema } from "@/lib/validation";
import { updateAgent, deleteAgent } from "@/lib/services/agents";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { agentId } = await params;
    await assertAgentInWorkspace(agentId, ctx.workspace.id);
    const input = parse(updateAgentSchema, await readJson(req));
    const agent = await updateAgent(agentId, {
      ...input,
      webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl,
    });
    return ok({ agent });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { agentId } = await params;
    await assertAgentInWorkspace(agentId, ctx.workspace.id);
    await deleteAgent(agentId);
    return ok({ ok: true });
  },
);
