import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardInWorkspace, assertColumnInBoard } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateBoardColumnV1Schema } from "@/lib/validation";
import { updateBoardColumn } from "@/lib/services/boards";
import { parseSubStates } from "@/lib/substates";
import { resolveColumnStage } from "@/lib/column-stage";
import { logActivity } from "@/lib/activity";
import { guardAgentSnapshot } from "@/lib/snapshots";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ boardId: string; columnId: string }> };

/** Read one column (name, stage, done-flag, WIP limit, sub-states). */
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
      stage: resolveColumnStage(column.stage, column.name, column.isDone),
      wipLimit: column.wipLimit,
      position: column.position,
      subStates: parseSubStates(column.subStates),
    },
  });
});

/** Rename a column and/or set its stage, sub-states, done-flag, or WIP limit. */
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

/**
 * Delete an EMPTY column. Refused (422) while any card lives there — including
 * soft-deleted ones, since the column FK cascade would destroy tickets that were
 * promised a 30-day restore. Nothing recoverable is ever lost through this path;
 * move or delete the cards first.
 */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:write");
  const { boardId, columnId } = await params;
  await assertBoardInWorkspace(boardId, agent.workspaceId);
  await assertColumnInBoard(columnId, boardId, agent.workspaceId);

  const count = await db.ticket.count({ where: { columnId } });
  if (count > 0) {
    throw new HttpError(
      422,
      "Move or delete this column's cards first (including any in the trash).",
      "column_not_empty",
    );
  }
  const total = await db.column.count({ where: { boardId } });
  if (total <= 1) throw new HttpError(422, "A board needs at least one column.", "last_column");

  await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });
  await db.column.delete({ where: { id: columnId } });
  await logActivity({
    actor: { type: "agent", id: agent.id, name: agent.name },
    action: "column.deleted",
    boardId,
    meta: { columnId },
  });
  return ok({ ok: true });
});
