import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess, assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { moveTicketSchema } from "@/lib/validation";
import { moveTicket, resolveColumnRef, transferTicket } from "@/lib/services/tickets";
import { db } from "@/lib/db";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const input = parse(moveTicketSchema, await readJson(req));
    const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { boardId: true } });
    if (input.boardId && input.boardId !== t.boardId) {
      await assertBoardAccess(ctx, input.boardId, true);
      const ticket = await transferTicket(ticketId, input.boardId, input, { type: "user", id: ctx.user.id, name: ctx.user.name });
      return ok({ ticket });
    }
    const columnId = (await resolveColumnRef(t.boardId, input))!;
    const ticket = await moveTicket(
      ticketId,
      columnId,
      input.position,
      { type: "user", id: ctx.user.id, name: ctx.user.name },
      input.subState,
      { completeSubtasks: input.completeSubtasks },
    );
    return ok({ ticket });
  },
);
