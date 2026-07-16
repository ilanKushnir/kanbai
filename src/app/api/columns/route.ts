import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { createColumnSchema } from "@/lib/validation";
import { markManualAction } from "@/lib/snapshots";
import { resolveColumnStage } from "@/lib/column-stage";
import { db } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const input = parse(createColumnSchema, await readJson(req));
  await assertBoardAccess(ctx, input.boardId, true);
  await markManualAction(ctx.workspace.id);

  const count = await db.column.count({ where: { boardId: input.boardId } });
  const column = await db.column.create({
    data: {
      boardId: input.boardId,
      name: input.name,
      // stage "done" and the isDone flag imply each other — keep them in lockstep.
      isDone: input.stage ? input.stage === "done" : input.isDone ?? false,
      stage: input.stage ?? (input.isDone ? "done" : null),
      position: count,
    },
  });
  return created({
    column: {
      id: column.id,
      name: column.name,
      wipLimit: column.wipLimit,
      isDone: column.isDone,
      stage: resolveColumnStage(column.stage, column.name, column.isDone),
      subStates: [],
    },
  });
});
