import { handler, ok, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentTicketAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createSubtaskSchema } from "@/lib/validation";
import { createSubtask } from "@/lib/services/subtasks";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:read");
    const { ticketId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const subtasks = await db.subtask.findMany({
      where: { ticketId },
      orderBy: { position: "asc" },
      select: { id: true, title: true, completed: true, position: true, createdAt: true },
    });
    return ok({ subtasks });
  },
);

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ ticketId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "tickets:write");
    const { ticketId } = await params;
    await assertAgentTicketAccess(agent, ticketId);
    const { title } = parse(createSubtaskSchema, await readJson(req));
    const ticket = await createSubtask(ticketId, title, { type: "agent", id: agent.id, name: agent.name });
    return created({ ticket });
  },
);
