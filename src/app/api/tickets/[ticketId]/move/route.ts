import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { moveTicketSchema } from "@/lib/validation";
import { moveTicket } from "@/lib/services/tickets";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const { workspace, user } = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ticketId, workspace.id);
    const { columnId, position } = parse(moveTicketSchema, await readJson(req));
    const ticket = await moveTicket(ticketId, columnId, position, {
      type: "user",
      id: user?.id,
      name: user?.name ?? "You",
    });
    return ok({ ticket });
  },
);
