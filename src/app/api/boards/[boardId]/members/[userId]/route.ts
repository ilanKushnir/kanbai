import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { setBoardMemberAccessSchema } from "@/lib/validation";
import { setBoardMemberAccess, listBoardMembers } from "@/lib/services/board-members";

/** Grant / change / revoke one member's access to this board (managers only). */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string; userId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { boardId, userId } = await params;
    await assertBoardAccess(ctx, boardId);
    const { level } = parse(setBoardMemberAccessSchema, await readJson(req));
    await setBoardMemberAccess(boardId, userId, level, { type: "user", id: ctx.user.id, name: ctx.user.name });
    const members = await listBoardMembers(boardId);
    return ok({ members });
  },
);
