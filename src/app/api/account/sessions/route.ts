import { handler, ok } from "@/lib/api";
import { getCurrentContext, destroyCurrentSession } from "@/lib/auth";
import { db } from "@/lib/db";

/** Sign out of every device: revoke all sessions for the current user. */
export const DELETE = handler(async () => {
  const ctx = await getCurrentContext();
  await db.session.deleteMany({ where: { userId: ctx.user.id } });
  await destroyCurrentSession(); // also clears the current cookie
  return ok({ ok: true });
});
