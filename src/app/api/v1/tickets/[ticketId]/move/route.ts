import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { moveTicketSchema } from "@/lib/validation";
import { moveTicket, resolveColumnRef } from "@/lib/services/tickets";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Move a ticket. Address the target by `columnId`, by name (`column` /
 * `columnName`, case-insensitive) or by `stage` (intake|backlog|active|done).
 * `position` is optional (default: end of the column); `subState` passes through.
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const input = parse(moveTicketSchema, await readJson(req));
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { boardId: true } });
    const columnId = (await resolveColumnRef(ticket.boardId, input))!;
    const moved = await moveTicket(
      ticketId,
      columnId,
      input.position,
      { type: "agent", id: agent.id, name: agent.name },
      input.subState,
    );
    return ok({ ticket: moved });
  },
);
