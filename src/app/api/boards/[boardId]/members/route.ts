import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { listBoardMembers } from "@/lib/services/board-members";

/** Who can see this board — anyone with board access may read the list
 *  (it feeds the assignee picker); managing grants is a separate, manager-only PATCH. */
export const GET = handler(
  async (_req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const ctx = await getCurrentContext();
    const { boardId } = await params;
    await assertBoardAccess(ctx, boardId);
    const members = await listBoardMembers(boardId);
    return ok({ members, canManage: ctx.isManager });
  },
);
