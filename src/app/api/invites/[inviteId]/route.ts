import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { db } from "@/lib/db";

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ inviteId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { inviteId } = await params;
    const invite = await db.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.workspaceId !== ctx.workspace.id) throw new HttpError(404, "Invite not found");
    await db.invite.update({ where: { id: inviteId }, data: { status: "revoked" } });
    return ok({ ok: true });
  },
);
