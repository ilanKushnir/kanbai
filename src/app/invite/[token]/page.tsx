import Link from "next/link";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { findValidInvite } from "@/lib/services/invites";
import { db } from "@/lib/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { AcceptInviteButton } from "@/components/auth/accept-invite-button";

export const metadata: Metadata = { title: "You're invited" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findValidInvite(token);

  if (!invite) {
    return (
      <AuthShell
        title="Invite not found"
        subtitle="This invite link is invalid, was revoked, or has expired."
        footer={
          <Link href="/login" className="font-medium text-primary hover:underline">
            Go to sign in
          </Link>
        }
      >
        <Link
          href="/login"
          className="block w-full rounded-xl bg-surface-2 px-4 py-2.5 text-center text-sm font-medium hover:bg-surface-3"
        >
          Sign in
        </Link>
      </AuthShell>
    );
  }

  const isWorkspace = invite.kind === "workspace";
  const [workspace, inviter, user] = await Promise.all([
    invite.workspaceId
      ? db.workspace.findUnique({ where: { id: invite.workspaceId }, select: { name: true } })
      : Promise.resolve(null),
    db.user.findUnique({ where: { id: invite.invitedById }, select: { name: true } }),
    getSessionUser(),
  ]);

  const title = isWorkspace ? `Join ${workspace?.name ?? "a workspace"}` : "Create your Kanbai account";
  const subtitle = `${inviter?.name ?? "Someone"} invited you${
    isWorkspace ? ` as ${invite.role === "admin" ? "an admin" : "a member"}` : " to Kanbai"
  }.`;

  if (user) {
    if (isWorkspace) {
      return (
        <AuthShell title={title} subtitle={subtitle}>
          <AcceptInviteButton token={token} label={`Join ${workspace?.name ?? "workspace"}`} />
        </AuthShell>
      );
    }
    return (
      <AuthShell title="You're already signed in" subtitle="Account invites are for new users.">
        <Link
          href="/"
          className="block w-full rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          Go to Kanbai
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <AuthForm
        mode="signup"
        inviteToken={token}
        lockedEmail={invite.email ?? undefined}
        submitLabel={isWorkspace ? "Join workspace" : "Create account"}
      />
    </AuthShell>
  );
}
