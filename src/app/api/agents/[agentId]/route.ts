import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertAgentAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateAgentSchema } from "@/lib/validation";
import { updateAgent, deleteAgent } from "@/lib/services/agents";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const { workspace } = await getCurrentContext();
    const { agentId } = await params;
    await assertAgentAccess(agentId, workspace.id);
    const input = parse(updateAgentSchema, await readJson(req));
    const agent = await updateAgent(agentId, {
      ...input,
      webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl,
    });
    return ok({ agent });
  },
);

export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ agentId: string }> }) => {
    const { workspace } = await getCurrentContext();
    const { agentId } = await params;
    await assertAgentAccess(agentId, workspace.id);
    await deleteAgent(agentId);
    return ok({ ok: true });
  },
);
