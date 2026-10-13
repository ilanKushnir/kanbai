import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateBoardSchema } from "@/lib/validation";
import { setBoardPublic, updateBoard } from "@/lib/services/boards";
import { markManualAction } from "@/lib/snapshots";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { boardId } = await params;
    await assertBoardAccess(ctx, boardId); // managers pass; also confirms workspace
    await markManualAction(ctx.workspace.id);
    const input = parse(updateBoardSchema, await readJson(req));

    const { isPublic: _isPublic, ...fields } = input;
    void _isPublic;
    if (Object.values(fields).some((v) => v !== undefined)) {
      await updateBoard(boardId, fields, { type: "user", id: ctx.user.id, name: ctx.user.name });
    }

    let publicState: { isPublic: boolean; publicId: string | null } | undefined;
    if (input.isPublic !== undefined) publicState = await setBoardPublic(boardId, input.isPublic);

    return ok({ ok: true, public: publicState });
  },
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { boardId } = await params;
    await assertBoardAccess(ctx, boardId); // confirms board is in this workspace
    await markManualAction(ctx.workspace.id);
    const board = await db.board.findUnique({ where: { id: boardId }, select: { name: true } });
    await db.board.delete({ where: { id: boardId } }); // cascades columns/tickets/labels/access
    await logActivity({
      actor: { type: "user", id: ctx.user.id, name: ctx.user.name },
      action: "board.deleted",
      meta: { boardId, name: board?.name ?? null },
    });
    return ok({ ok: true });
  },
);
