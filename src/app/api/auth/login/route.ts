import { handler, ok, HttpError } from "@/lib/api";
import { parse, readJson } from "@/lib/parse";
import { loginSchema } from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";

// A throwaway hash so the no-such-user path still spends scrypt time — otherwise
// response latency reveals whether an email has an account (a timing oracle).
const DUMMY_HASH = hashPassword("login-timing-equalizer");

export const POST = handler(async (req: Request) => {
  const input = parse(loginSchema, await readJson(req));
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  // Same response — and same work — whether the email exists or not.
  const passwordOk = verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || user.status !== "active" || !passwordOk) {
    throw new HttpError(401, "Incorrect email or password.", "bad_credentials");
  }

  await createSession(user.id);
  return ok({ ok: true });
});
