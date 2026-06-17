import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createColumnSchema } from "@/lib/validation";
import { db } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const { workspace } = await getCurrentContext();
  const input = parse(createColumnSchema, await readJson(req));
  await assertBoardAccess(input.boardId, workspace.id);

  const count = await db.column.count({ where: { boardId: input.boardId } });
  const column = await db.column.create({
    data: {
      boardId: input.boardId,
      name: input.name,
      isDone: input.isDone ?? false,
      position: count,
    },
  });
  return created({
    column: { id: column.id, name: column.name, wipLimit: column.wipLimit, isDone: column.isDone },
  });
});
