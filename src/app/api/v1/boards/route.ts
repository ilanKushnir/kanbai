import { handler, ok, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentBoardWhere } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createBoardV1Schema } from "@/lib/validation";
import { createBoardWithStructure } from "@/lib/services/boards";
import { parseSubStates } from "@/lib/substates";
import { resolveColumnStage } from "@/lib/column-stage";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:read");

  const boards = await db.board.findMany({
    // Owner-mapped agents only see the boards their owning user can access.
    where: { ...(await agentBoardWhere(agent)), archived: false },
    orderBy: { position: "asc" },
    include: {
      labels: { select: { id: true, name: true, color: true } },
      columns: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, isDone: true, stage: true, subStates: true, _count: { select: { tickets: true } } },
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
        // Semantic stage (intake | backlog | active | done) — drives board styling.
        stage: resolveColumnStage(c.stage, c.name, c.isDone),
        // The column's progress statuses — set a ticket's via PATCH { subState }.
        subStates: parseSubStates(c.subStates),
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
