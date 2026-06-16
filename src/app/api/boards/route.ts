import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createBoardSchema } from "@/lib/validation";
import { createBoard } from "@/lib/services/boards";

export const POST = handler(async (req: Request) => {
  const { workspace, user } = await getCurrentContext();
  const input = parse(createBoardSchema, await readJson(req));
  const board = await createBoard(workspace.id, input, {
    type: "user",
    id: user?.id,
    name: user?.name ?? "You",
  });
  return created({ board: { id: board.id, name: board.name, slug: board.slug, color: board.color } });
});
