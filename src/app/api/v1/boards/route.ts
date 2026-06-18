import { handler, ok, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { createBoardV1Schema } from "@/lib/validation";
import { createBoardWithStructure } from "@/lib/services/boards";
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

/** Create a board with custom columns + labels (migration). */
export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:write");
  const input = parse(createBoardV1Schema, await readJson(req));
  const board = await createBoardWithStructure(agent.workspaceId, input, {
    type: "agent",
    id: agent.id,
    name: agent.name,
  });
  return created({
    board: {
      id: board.id,
      name: board.name,
      slug: board.slug,
      columns: board.columns,
      labels: board.labels,
    },
  });
});
