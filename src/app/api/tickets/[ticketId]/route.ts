import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateTicketSchema } from "@/lib/validation";
import { updateTicket, deleteTicket } from "@/lib/services/tickets";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const input = parse(updateTicketSchema, await readJson(req));
    const ticket = await updateTicket(ticketId, input, { type: "user", id: ctx.user.id, name: ctx.user.name });
    return ok({ ticket });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    await deleteTicket(ticketId, { type: "user", id: ctx.user.id, name: ctx.user.name });
    return ok({ ok: true });
  },
);
