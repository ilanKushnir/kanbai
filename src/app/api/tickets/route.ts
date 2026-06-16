import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createTicketSchema } from "@/lib/validation";
import { createTicket } from "@/lib/services/tickets";

export const POST = handler(async (req: Request) => {
  const { workspace, user } = await getCurrentContext();
  const input = parse(createTicketSchema, await readJson(req));
  await assertBoardAccess(input.boardId, workspace.id);
  const ticket = await createTicket(input, { type: "user", id: user?.id, name: user?.name ?? "You" });
  return created({ ticket });
});
