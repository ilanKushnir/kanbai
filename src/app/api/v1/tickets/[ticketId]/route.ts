import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertTicketInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateTicketSchema } from "@/lib/validation";
import { updateTicket } from "@/lib/services/tickets";
import { db } from "@/lib/db";
import { ticketInclude, serializeTicket } from "@/lib/serialize";
import { HttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:read");
    const { ticketId } = await params;
    await assertTicketInWorkspace(ticketId, agent.workspaceId);
    const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: ticketInclude });
    if (!ticket) throw new HttpError(404, "Ticket not found");
    return ok({ ticket: serializeTicket(ticket) });
  },
);

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertTicketInWorkspace(ticketId, agent.workspaceId);
    const input = parse(updateTicketSchema, await readJson(req));
    const ticket = await updateTicket(ticketId, input, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ticket });
  },
);
