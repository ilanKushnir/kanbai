import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { createSubtaskSchema } from "@/lib/validation";
import { createSubtask, createSubtasks } from "@/lib/services/subtasks";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const ctx = await getCurrentContext();
    const { ticketId } = await params;
    await assertTicketAccess(ctx, ticketId, true);
    const { id, title, titles } = parse(createSubtaskSchema, await readJson(req));
    const actor = { type: "user" as const, id: ctx.user.id, name: ctx.user.name };
    const result = titles ? await createSubtasks(ticketId, titles, actor) : await createSubtask(ticketId, title!, actor, id);
    return created(result);
  },
);
