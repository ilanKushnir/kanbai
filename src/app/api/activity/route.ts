import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { listActivity } from "@/lib/services/activity-feed";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Workspace activity feed for the UI:
 *   GET /api/activity?limit=50&actor=agent|user|all&since=<ISO>&boardId=<id>
 * Board-scoped rows are capped to the boards the signed-in user can see.
 */
export const GET = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const actor = url.searchParams.get("actor") ?? "all";
  const since = url.searchParams.get("since");
  const boardId = url.searchParams.get("boardId");

  const boardIds = ctx.isManager
    ? null
    : (await db.board.findMany({ where: boardWhereForContext(ctx), select: { id: true } })).map((b) => b.id);

  const activity = await listActivity({
    workspaceId: ctx.workspace.id,
    limit: Number.isFinite(limit) ? limit : 50,
    actorType: actor,
    since,
    boardId,
    boardIds,
  });
  return ok({ activity });
});
