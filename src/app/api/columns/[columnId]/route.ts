import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertColumnAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateColumnSchema } from "@/lib/validation";
import { db } from "@/lib/db";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ columnId: string }> }) => {
    const { workspace } = await getCurrentContext();
    const { columnId } = await params;
    await assertColumnAccess(columnId, workspace.id);
    const input = parse(updateColumnSchema, await readJson(req));
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.wipLimit !== undefined) data.wipLimit = input.wipLimit;
    const column = await db.column.update({ where: { id: columnId }, data });
    return ok({ column: { id: column.id, name: column.name, wipLimit: column.wipLimit, isDone: column.isDone } });
  },
);
