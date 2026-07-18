import { handler, created } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createWorkspaceInviteSchema } from "@/lib/validation";
import { createWorkspaceInvite } from "@/lib/services/invites";

/** Workspace invite: owner/admin invites an EXISTING account into the workspace. */
export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  assertManager(ctx);
  const input = parse(createWorkspaceInviteSchema, await readJson(req));
  const { token, invite } = await createWorkspaceInvite({
    workspaceId: ctx.workspace.id,
    invitedById: ctx.user.id,
    actorRole: ctx.role,
    email: input.email,
    role: input.role ?? "member",
    boardAccess: input.boardAccess,
  });
  return created({ token, inviteId: invite.id, kind: invite.kind });
});
