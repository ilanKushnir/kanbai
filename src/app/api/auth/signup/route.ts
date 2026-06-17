import { handler, created, HttpError } from "@/lib/api";
import { parse, readJson } from "@/lib/parse";
import { signupSchema } from "@/lib/validation";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { createWorkspaceForUser } from "@/lib/services/workspaces";
import { findValidInvite, applyWorkspaceInvite, markInviteAccepted } from "@/lib/services/invites";
import { db } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const input = parse(signupSchema, await readJson(req));
  const email = input.email.trim().toLowerCase();

  if (await db.user.findUnique({ where: { email } })) {
    throw new HttpError(409, "An account with that email already exists. Try logging in.", "email_taken");
  }

  if (input.inviteToken) {
    const invite = await findValidInvite(input.inviteToken);
    if (!invite) throw new HttpError(400, "This invite is invalid or has expired.", "bad_invite");
    if (invite.email && invite.email.toLowerCase() !== email) {
      throw new HttpError(400, "This invite was issued for a different email address.", "invite_email_mismatch");
    }

    const user = await db.user.create({
      data: { email, name: input.name, passwordHash: hashPassword(input.password), systemRole: "user" },
    });

    if (invite.kind === "account") {
      await createWorkspaceForUser(user.id, `${input.name}'s Workspace`);
      await markInviteAccepted(invite.id, user.id);
    } else {
      await applyWorkspaceInvite(invite, user.id);
    }
    await createSession(user.id);
    return created({ ok: true });
  }

  // No invite → only the very first user may sign up (becomes system admin).
  const userCount = await db.user.count();
  if (userCount > 0) {
    throw new HttpError(403, "Sign-ups are invite-only. Ask an admin for an invite.", "signups_closed");
  }

  const user = await db.user.create({
    data: {
      email,
      name: input.name,
      passwordHash: hashPassword(input.password),
      systemRole: "admin", // first user owns the whole instance
    },
  });
  await createWorkspaceForUser(user.id, `${input.name}'s Workspace`);
  await createSession(user.id);
  return created({ ok: true, admin: true });
});
