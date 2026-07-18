import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { createSubtaskSchema } from "@/lib/validation";
import { createSubtask } from "@/lib/services/subtasks";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const { title } = parse(createSubtaskSchema, await readJson(req));
    const ticket = await createSubtask(ticketId, title, { type: "user", id: ctx.user.id, name: ctx.user.name });
    return created({ ticket });
  },
);
