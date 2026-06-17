import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertColumnAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateColumnSchema } from "@/lib/validation";
import { db } from "@/lib/db";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ columnId: string }> }) => {
    const ctx = await getCurrentContext();
    const { columnId } = await params;
    await assertColumnAccess(ctx, columnId, true);
    const input = parse(updateColumnSchema, await readJson(req));
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.wipLimit !== undefined) data.wipLimit = input.wipLimit;
    if (input.isDone !== undefined) data.isDone = input.isDone;
    const column = await db.column.update({ where: { id: columnId }, data });
    return ok({ column: { id: column.id, name: column.name, wipLimit: column.wipLimit, isDone: column.isDone } });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ columnId: string }> }) => {
    const ctx = await getCurrentContext();
    const { columnId } = await params;
    await assertColumnAccess(ctx, columnId, true);

    const count = await db.ticket.count({ where: { columnId } });
    if (count > 0) throw new HttpError(422, "Move or delete this column's cards first.", "column_not_empty");
    const col = await db.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
    const total = await db.column.count({ where: { boardId: col!.boardId } });
    if (total <= 1) throw new HttpError(422, "A board needs at least one column.", "last_column");

    await db.column.delete({ where: { id: columnId } });
    return ok({ ok: true });
  },
);
