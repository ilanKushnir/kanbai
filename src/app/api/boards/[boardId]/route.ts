import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateBoardSchema } from "@/lib/validation";
import { setBoardPublic } from "@/lib/services/boards";
import { db } from "@/lib/db";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { boardId } = await params;
    await assertBoardAccess(ctx, boardId); // managers pass; also confirms workspace
    const input = parse(updateBoardSchema, await readJson(req));

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.color !== undefined) data.color = input.color;
    if (Object.keys(data).length) await db.board.update({ where: { id: boardId }, data });

    let publicState: { isPublic: boolean; publicId: string | null } | undefined;
    if (input.isPublic !== undefined) publicState = await setBoardPublic(boardId, input.isPublic);

    return ok({ ok: true, public: publicState });
  },
);
