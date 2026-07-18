import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { reorderSubtasksSchema } from "@/lib/validation";
import { reorderSubtasks } from "@/lib/services/subtasks";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const { orderedIds } = parse(reorderSubtasksSchema, await readJson(req));
    const ticket = await reorderSubtasks(ticketId, orderedIds, { type: "user", id: ctx.user.id, name: ctx.user.name });
    return ok({ ticket });
  },
);
