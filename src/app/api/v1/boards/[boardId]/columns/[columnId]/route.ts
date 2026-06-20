import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardInWorkspace, assertColumnInBoard } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateBoardColumnV1Schema } from "@/lib/validation";
import { updateBoardColumn } from "@/lib/services/boards";
import { parseSubStates } from "@/lib/substates";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ boardId: string; columnId: string }> };

/** Read one column (name, done-flag, WIP limit, sub-states). */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:read");
  const { boardId, columnId } = await params;
  await assertBoardInWorkspace(boardId, agent.workspaceId);
  await assertColumnInBoard(columnId, boardId, agent.workspaceId);

  const column = await db.column.findUnique({ where: { id: columnId } });
  if (!column) throw new HttpError(404, "Column not found");
  return ok({
    column: {
      id: column.id,
      name: column.name,
      isDone: column.isDone,
      wipLimit: column.wipLimit,
      position: column.position,
      subStates: parseSubStates(column.subStates),
    },
  });
});

/** Rename a column and/or set its sub-states, done-flag, or WIP limit. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:write");
  const { boardId, columnId } = await params;
  await assertBoardInWorkspace(boardId, agent.workspaceId);
  await assertColumnInBoard(columnId, boardId, agent.workspaceId);

  const input = parse(updateBoardColumnV1Schema, await readJson(req));
  const column = await updateBoardColumn(agent.workspaceId, boardId, columnId, input, {
    type: "agent",
    id: agent.id,
    name: agent.name,
  });
  return ok({ column });
});
