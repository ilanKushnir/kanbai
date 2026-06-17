import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { moveTicketSchema } from "@/lib/validation";
import { moveTicket } from "@/lib/services/tickets";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const { columnId, position } = parse(moveTicketSchema, await readJson(req));
    const ticket = await moveTicket(ticketId, columnId, position, {
      type: "user",
      id: ctx.user.id,
      name: ctx.user.name,
    });
    return ok({ ticket });
  },
);
