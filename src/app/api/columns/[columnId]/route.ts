import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertColumnAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateColumnSchema } from "@/lib/validation";
import { markManualAction } from "@/lib/snapshots";
import { parseSubStates, stringifySubStates } from "@/lib/substates";
import { resolveColumnStage } from "@/lib/column-stage";
import { applyColumnStageSync } from "@/lib/services/boards";
import { reconcileColumnSubStates } from "@/lib/services/tickets";
import { db } from "@/lib/db";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ columnId: string }> }) => {
    const ctx = await getCurrentContext();
    const { columnId } = await params;
    await assertColumnAccess(ctx, columnId, true);
    await markManualAction(ctx.workspace.id);
    const input = parse(updateColumnSchema, await readJson(req));
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.wipLimit !== undefined) data.wipLimit = input.wipLimit;
    applyColumnStageSync(data, input); // stage ↔ isDone stay in lockstep
    if (input.subStates !== undefined) data.subStates = stringifySubStates(input.subStates);
    const column = await db.column.update({ where: { id: columnId }, data });
    // Changing the band list can orphan tickets' sub-states — snap them back valid.
    if (input.subStates !== undefined) await reconcileColumnSubStates(columnId);
    return ok({
      column: {
        id: column.id,
        name: column.name,
        wipLimit: column.wipLimit,
        isDone: column.isDone,
        stage: resolveColumnStage(column.stage, column.name, column.isDone),
        subStates: parseSubStates(column.subStates),
      },
    });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ columnId: string }> }) => {
    const ctx = await getCurrentContext();
    const { columnId } = await params;
    await assertColumnAccess(ctx, columnId, true);
    await markManualAction(ctx.workspace.id);

    // Count soft-deleted tickets too: the column FK cascades, so deleting the
    // column would hard-delete trashed tickets that were promised 30-day restore.
    const count = await db.ticket.count({ where: { columnId } });
    if (count > 0)
      throw new HttpError(
        422,
        "Move or delete this column's cards first (including any in Recently deleted).",
        "column_not_empty",
      );
    const col = await db.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
    const total = await db.column.count({ where: { boardId: col!.boardId } });
    if (total <= 1) throw new HttpError(422, "A board needs at least one column.", "last_column");

    await db.column.delete({ where: { id: columnId } });
    return ok({ ok: true });
  },
);
