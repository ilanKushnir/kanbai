import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateSubtaskSchema } from "@/lib/validation";
import { updateSubtask, deleteSubtask } from "@/lib/services/subtasks";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string; subtaskId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId, subtaskId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const input = parse(updateSubtaskSchema, await readJson(req));
    const ticket = await updateSubtask(ticketId, subtaskId, input, { type: "user", id: ctx.user.id, name: ctx.user.name });
    return ok({ ticket });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ ticketId: string; subtaskId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId, subtaskId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const ticket = await deleteSubtask(ticketId, subtaskId, { type: "user", id: ctx.user.id, name: ctx.user.name });
    return ok({ ticket });
  },
);
