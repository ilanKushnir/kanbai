import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { updateAccountSchema } from "@/lib/validation";
import { parseUserSettings } from "@/lib/user-settings";
import { db } from "@/lib/db";

/** Update the signed-in user's profile + personal preferences. */
export const PATCH = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const input = parse(updateAccountSchema, await readJson(req));

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (email !== ctx.user.email) {
      const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existing && existing.id !== ctx.user.id) {
        throw new HttpError(409, "That email is already in use.", "email_taken");
      }
      data.email = email;
    }
  }
  if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl || null;
  if (input.defaultLanding !== undefined || input.weekStartsOn !== undefined || input.handedness !== undefined) {
    const settings = parseUserSettings(ctx.user.settings);
    if (input.defaultLanding !== undefined) settings.defaultLanding = input.defaultLanding;
    if (input.weekStartsOn !== undefined) settings.weekStartsOn = input.weekStartsOn;
    if (input.handedness !== undefined) settings.handedness = input.handedness;
    data.settings = JSON.stringify(settings);
  }

  if (Object.keys(data).length) {
    try {
      await db.user.update({ where: { id: ctx.user.id }, data });
    } catch (e) {
      // The unique constraint is the source of truth; the pre-check above is just a fast path.
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw new HttpError(409, "That email is already in use.", "email_taken");
      }
      throw e;
    }
  }
  return ok({ ok: true });
});
