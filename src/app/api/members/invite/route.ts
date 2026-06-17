import { handler, created } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createInviteSchema } from "@/lib/validation";
import { createInvite } from "@/lib/services/invites";

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  assertManager(ctx);
  const input = parse(createInviteSchema, await readJson(req));
  const { token, invite } = await createInvite({
    kind: input.kind,
    invitedById: ctx.user.id,
    workspaceId: input.kind === "workspace" ? ctx.workspace.id : null,
    email: input.email || null,
    role: input.role ?? "member",
    boardAccess: input.kind === "workspace" ? input.boardAccess : undefined,
  });
  return created({ token, inviteId: invite.id, kind: invite.kind });
});
