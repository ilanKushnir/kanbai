import { handler, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createTicketSchema } from "@/lib/validation";
import { createTicket } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "tickets:write");
  const input = parse(createTicketSchema, await readJson(req));
  await assertBoardAccess(input.boardId, agent.workspaceId);

  const ticket = await createTicket(input, { type: "agent", id: agent.id, name: agent.name });
  return created({ ticket });
});
