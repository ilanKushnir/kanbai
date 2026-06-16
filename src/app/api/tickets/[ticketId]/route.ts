import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateTicketSchema } from "@/lib/validation";
import { updateTicket, deleteTicket } from "@/lib/services/tickets";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const { workspace, user } = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ticketId, workspace.id);
    const input = parse(updateTicketSchema, await readJson(req));
    const ticket = await updateTicket(ticketId, input, {
      type: "user",
      id: user?.id,
      name: user?.name ?? "You",
    });
    return ok({ ticket });
  },
);

export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const { workspace, user } = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ticketId, workspace.id);
    await deleteTicket(ticketId, { type: "user", id: user?.id, name: user?.name ?? "You" });
    return ok({ ok: true });
  },
);
