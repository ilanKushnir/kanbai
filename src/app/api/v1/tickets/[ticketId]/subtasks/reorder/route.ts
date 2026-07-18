import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { reorderSubtasksSchema } from "@/lib/validation";
import { reorderSubtasks } from "@/lib/services/subtasks";

export const dynamic = "force-dynamic";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const { orderedIds } = parse(reorderSubtasksSchema, await readJson(req));
    const ticket = await reorderSubtasks(ticketId, orderedIds, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ticket });
  },
);
