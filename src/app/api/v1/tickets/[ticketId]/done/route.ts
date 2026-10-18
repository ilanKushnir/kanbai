import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentTicketAccess } from "@/lib/access";
import { moveTicketToDone } from "@/lib/services/tickets";
import { parse } from "@/lib/parse";
import { doneV1Schema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Close a ticket in one call: moves it to its board's done column (422 if the
 * board has none). Equivalent to the user dragging it to Done — the ticket
 * stays fully restorable/movable afterwards. Open subtasks are completed too,
 * unless the body says `{ "completeSubtasks": false }`.
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const body = parse(doneV1Schema, await req.json().catch(() => undefined));
    const ticket = await moveTicketToDone(ticketId, { type: "agent", id: agent.id, name: agent.name }, { completeSubtasks: body?.completeSubtasks ?? true });
    return ok({ ticket });
  },
);
