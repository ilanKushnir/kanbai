import { handler, ok, HttpError } from "@/lib/api";
import { requireApiSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

/** Revoke a system-level account invite (system admin only). */
export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ inviteId: string }> }) => {
    await requireApiSystemAdmin();
    const { inviteId } = await params;
    const invite = await db.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.kind !== "account") throw new HttpError(404, "Invite not found");
    await db.invite.update({ where: { id: inviteId }, data: { status: "revoked" } });
    return ok({ ok: true });
  },
);
