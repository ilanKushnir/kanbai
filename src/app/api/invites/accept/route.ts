import { handler, ok, HttpError } from "@/lib/api";
import { parse, readJson } from "@/lib/parse";
import { getSessionUser, setActiveWorkspace } from "@/lib/auth";
import { findValidInvite, applyWorkspaceInvite } from "@/lib/services/invites";
import { z } from "zod";

const schema = z.object({ token: z.string().min(1) });

/** A signed-in user accepts a workspace invite (joins the inviter's workspace). */
export const POST = handler(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Sign in to accept this invite.", "unauthenticated");
  const { token } = parse(schema, await readJson(req));
  const invite = await findValidInvite(token);
  if (!invite) throw new HttpError(400, "This invite is invalid or has expired.", "bad_invite");
  if (invite.kind !== "workspace") throw new HttpError(400, "That invite can't be accepted from here.");
  // An email-targeted invite may only be redeemed by that email (a forwarded
  // link shouldn't let anyone else join the workspace).
  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new HttpError(403, "This invite was issued for a different email address.", "invite_email_mismatch");
  }

  const workspaceId = await applyWorkspaceInvite(invite, user.id);
  await setActiveWorkspace(workspaceId);
  return ok({ ok: true, workspaceId });
});
