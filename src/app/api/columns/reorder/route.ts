import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { reorderColumnsSchema } from "@/lib/validation";
import { markManualAction } from "@/lib/snapshots";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const { boardId, orderedIds } = parse(reorderColumnsSchema, await readJson(req));
  await assertBoardAccess(ctx, boardId, true);
  await markManualAction(ctx.workspace.id);

  const cols = await db.column.findMany({ where: { boardId }, select: { id: true } });
  const valid = new Set(cols.map((c) => c.id));
  if (orderedIds.some((id) => !valid.has(id))) {
    throw new HttpError(422, "Column list does not match this board.");
  }
  await db.$transaction(
    orderedIds.map((id, i) => db.column.update({ where: { id }, data: { position: i } })),
  );
  await logActivity({ actor: { type: "user", id: ctx.user.id, name: ctx.user.name }, action: "columns.reordered", boardId });
  return ok({ ok: true });
});
