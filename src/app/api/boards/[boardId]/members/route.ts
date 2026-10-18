import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { shareBoardByEmailSchema } from "@/lib/validation";
import { listBoardMembers, shareBoardByEmail } from "@/lib/services/board-members";

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

/** Share with an existing account by email — joins them to the workspace and grants access at once (managers only). */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { boardId } = await params;
    await assertBoardAccess(ctx, boardId);
    const { email, level } = parse(shareBoardByEmailSchema, await readJson(req));
    const shared = await shareBoardByEmail(boardId, email, level, { type: "user", id: ctx.user.id, name: ctx.user.name });
    const members = await listBoardMembers(boardId);
    return ok({ shared, members });
  },
);
