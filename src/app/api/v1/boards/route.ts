import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:read");

  const boards = await db.board.findMany({
    where: { workspaceId: agent.workspaceId, archived: false },
    orderBy: { position: "asc" },
    include: {
      labels: { select: { id: true, name: true, color: true } },
      columns: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, isDone: true, _count: { select: { tickets: true } } },
      },
    },
  });

  return ok({
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      color: b.color,
      labels: b.labels,
      columns: b.columns.map((c) => ({
        id: c.id,
        name: c.name,
        isDone: c.isDone,
        ticketCount: c._count.tickets,
      })),
    })),
  });
});
