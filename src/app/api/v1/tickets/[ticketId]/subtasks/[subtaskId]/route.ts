import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateSubtaskSchema } from "@/lib/validation";
import { updateSubtask, deleteSubtask } from "@/lib/services/subtasks";

export const dynamic = "force-dynamic";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string; subtaskId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId, subtaskId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const input = parse(updateSubtaskSchema, await readJson(req));
    const ticket = await updateSubtask(ticketId, subtaskId, input, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ticket });
  },
);

export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string; subtaskId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId, subtaskId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const ticket = await deleteSubtask(ticketId, subtaskId, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ticket });
  },
);
