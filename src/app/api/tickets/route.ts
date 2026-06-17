import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { createTicketSchema } from "@/lib/validation";
import { createTicket } from "@/lib/services/tickets";

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const input = parse(createTicketSchema, await readJson(req));
  await assertBoardAccess(ctx, input.boardId, true);
  const ticket = await createTicket(input, { type: "user", id: ctx.user.id, name: ctx.user.name });
  return created({ ticket });
});
