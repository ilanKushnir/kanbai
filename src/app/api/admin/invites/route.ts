import { handler, ok, created } from "@/lib/api";
import { requireApiSystemAdmin } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createSystemInviteSchema } from "@/lib/validation";
import { createSystemInvite } from "@/lib/services/invites";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** List pending system-level account invites (system admin only). */
export const GET = handler(async () => {
  await requireApiSystemAdmin();
  const invites = await db.invite.findMany({
    where: { kind: "account", status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  return ok({
    invites: invites.map((i) => ({
      id: i.id,
      token: i.token,
      email: i.email,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
    })),
  });
});

/** Create a system-level account invite — lets a new person register. */
export const POST = handler(async (req: Request) => {
  const admin = await requireApiSystemAdmin();
  const input = parse(createSystemInviteSchema, await readJson(req));
  const { token, invite } = await createSystemInvite({ invitedBy: admin, email: input.email || null });
  return created({ token, inviteId: invite.id, kind: invite.kind });
});
