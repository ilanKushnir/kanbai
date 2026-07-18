import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { pinBoardSchema } from "@/lib/validation";
import { setBoardPinned } from "@/lib/services/board-pins";

/**
 * Pin or unpin this board for the signed-in user. Personal, per-user state —
 * any access level (view or edit) may pin; nothing changes for other users.
 */
export const PUT = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const ctx = await getCurrentContext();
    const { boardId } = await params;
    await assertBoardAccess(ctx, boardId);
    const { pinned } = parse(pinBoardSchema, await readJson(req));
    const pinnedBoardIds = await setBoardPinned(ctx.user.id, boardId, pinned);
    return ok({ pinnedBoardIds });
  },
);
