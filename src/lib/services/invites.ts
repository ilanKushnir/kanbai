import { db } from "@/lib/db";
import { randomToken } from "@/lib/password";
import { HttpError } from "@/lib/api";
import { createWorkspaceForUser } from "./workspaces";
import type { Invite } from "@/generated/prisma";

const INVITE_DAYS = 14;

/**
 * Two strictly separate invite flows share the Invite table, split by `kind`:
 *   - "account"   → system-level invite. Only a system admin can issue one; the
 *                   recipient registers a brand-new Kanbai account (with their
 *                   own personal workspace). Never tied to a workspace.
 *   - "workspace" → a workspace owner/admin invites an EXISTING Kanbai account
 *                   into their workspace. It never creates a new account.
 */

export async function findValidInvite(token: string): Promise<Invite | null> {
  const invite = await db.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) return null;
  return invite;
}

function inviteExpiry() {
  return new Date(Date.now() + INVITE_DAYS * 86400000);
}

/** System-level account invite — lets a new person register. System admin only. */
export async function createSystemInvite(opts: {
  invitedBy: { id: string; systemRole: string };
  email?: string | null;
}) {
  if (opts.invitedBy.systemRole !== "admin") {
    throw new HttpError(403, "Only a system admin can create system account invites.", "forbidden");
  }
  const email = opts.email?.trim().toLowerCase() || null;
  if (email && (await db.user.findUnique({ where: { email } }))) {
    throw new HttpError(409, "An account with that email already exists.", "email_taken");
  }
  const token = randomToken();
  const invite = await db.invite.create({
    data: {
      token,
      kind: "account",
      role: "member",
      workspaceId: null,
      email,
      invitedById: opts.invitedBy.id,
      expiresAt: inviteExpiry(),
    },
  });
  return { invite, token };
}

/**
 * Workspace invite — a workspace owner/admin invites an EXISTING account in.
 * Unknown emails are rejected: workspace invites never create accounts.
 */
export async function createWorkspaceInvite(opts: {
  workspaceId: string;
  invitedById: string;
  actorRole: "owner" | "admin" | "member";
  email: string;
  role?: "admin" | "member";
  boardAccess?: { boardId: string; level: string }[];
}) {
  if (opts.actorRole !== "owner" && opts.actorRole !== "admin") {
    throw new HttpError(403, "Only workspace owners/admins can invite members.", "forbidden");
  }
  const email = opts.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    throw new HttpError(
      422,
      "No Kanbai account uses that email. Workspace invites are for existing accounts — a system admin must create the account first.",
      "unknown_email",
    );
  }
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: opts.workspaceId, userId: user.id } },
  });
  if (membership) {
    throw new HttpError(409, "That user is already a member of this workspace.", "already_member");
  }

  const token = randomToken();
  const invite = await db.invite.create({
    data: {
      token,
      kind: "workspace",
      role: opts.role ?? "member",
      workspaceId: opts.workspaceId,
      email,
      boardAccess: opts.boardAccess?.length ? JSON.stringify(opts.boardAccess) : null,
      invitedById: opts.invitedById,
      expiresAt: inviteExpiry(),
    },
  });
  return { invite, token };
}

/** Add the user to the invite's workspace and apply board-access presets. */
export async function applyWorkspaceInvite(invite: Invite, userId: string) {
  if (invite.kind !== "workspace" || !invite.workspaceId) {
    throw new HttpError(400, "Not a workspace invite");
  }
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
    update: { role: invite.role },
    create: { workspaceId: invite.workspaceId, userId, role: invite.role },
  });

  if (invite.boardAccess) {
    try {
      const presets = JSON.parse(invite.boardAccess) as { boardId: string; level: string }[];
      for (const p of presets) {
        // Only grant access to boards that belong to this workspace.
        const board = await db.board.findUnique({ where: { id: p.boardId }, select: { workspaceId: true } });
        if (!board || board.workspaceId !== invite.workspaceId) continue;
        await db.boardAccess.upsert({
          where: { boardId_userId: { boardId: p.boardId, userId } },
          update: { level: p.level },
          create: { boardId: p.boardId, userId, level: p.level },
        });
      }
    } catch {
      /* ignore malformed presets */
    }
  }

  await db.invite.update({ where: { id: invite.id }, data: { status: "accepted", acceptedById: userId } });
  return invite.workspaceId;
}

/**
 * Redeem a system (account) invite at signup: create the account plus its
 * personal workspace. Workspace invites are rejected here — they can only be
 * accepted by an already-signed-in existing account.
 */
export async function redeemSystemInviteSignup(
  invite: Invite,
  data: { email: string; name: string; passwordHash: string },
) {
  if (invite.kind !== "account") {
    throw new HttpError(
      403,
      "This invite adds an existing account to a workspace — it can't create a new account. Sign in first, then open the invite link again.",
      "workspace_invite_signin_required",
    );
  }
  const user = await db.user.create({
    data: { email: data.email, name: data.name, passwordHash: data.passwordHash, systemRole: "user" },
  });
  await createWorkspaceForUser(user.id, `${data.name}'s Workspace`);
  await markInviteAccepted(invite.id, user.id);
  return user;
}

export async function markInviteAccepted(inviteId: string, userId: string) {
  await db.invite.update({ where: { id: inviteId }, data: { status: "accepted", acceptedById: userId } });
}
