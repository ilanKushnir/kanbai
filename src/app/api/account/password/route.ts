import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext, revokeOtherSessions } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { changePasswordSchema } from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const { currentPassword, newPassword } = parse(changePasswordSchema, await readJson(req));
  if (!verifyPassword(currentPassword, ctx.user.passwordHash)) {
    throw new HttpError(403, "Current password is incorrect.", "bad_password");
  }
  await db.user.update({ where: { id: ctx.user.id }, data: { passwordHash: hashPassword(newPassword) } });
  // A password change should log out every other session (a leaked/older one
  // must not survive the change); the current session stays signed in.
  await revokeOtherSessions(ctx.user.id);
  return ok({ ok: true });
});
