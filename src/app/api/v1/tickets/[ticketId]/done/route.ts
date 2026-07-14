import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertTicketInWorkspace } from "@/lib/access";
import { moveTicketToDone } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/**
 * Close a ticket in one call: moves it to its board's done column (422 if the
 * board has none). Equivalent to the user dragging it to Done — the ticket
 * stays fully restorable/movable afterwards.
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertTicketInWorkspace(ticketId, agent.workspaceId);
    const ticket = await moveTicketToDone(ticketId, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ticket });
  },
);
