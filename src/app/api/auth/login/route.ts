import { handler, ok, HttpError } from "@/lib/api";
import { parse, readJson } from "@/lib/parse";
import { loginSchema } from "@/lib/validation";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const input = parse(loginSchema, await readJson(req));
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  // Same response whether the email exists or not (avoid user enumeration).
  if (!user || user.status !== "active" || !verifyPassword(input.password, user.passwordHash)) {
    throw new HttpError(401, "Incorrect email or password.", "bad_credentials");
  }

  await createSession(user.id);
  return ok({ ok: true });
});
