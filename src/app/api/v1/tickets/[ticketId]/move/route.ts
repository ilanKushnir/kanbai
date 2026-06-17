import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertTicketInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { moveTicketSchema } from "@/lib/validation";
import { moveTicket } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertTicketInWorkspace(ticketId, agent.workspaceId);
    const { columnId, position } = parse(moveTicketSchema, await readJson(req));
    const ticket = await moveTicket(ticketId, columnId, position, {
      type: "agent",
      id: agent.id,
      name: agent.name,
    });
    return ok({ ticket });
  },
);
