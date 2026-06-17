import { handler, created } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createBoardSchema } from "@/lib/validation";
import { createBoard } from "@/lib/services/boards";

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  assertManager(ctx); // only owners/admins create boards
  const input = parse(createBoardSchema, await readJson(req));
  const board = await createBoard(ctx.workspace.id, input, {
    type: "user",
    id: ctx.user.id,
    name: ctx.user.name,
  });
  return created({ board: { id: board.id, name: board.name, slug: board.slug, color: board.color } });
});
