import { db } from "@/lib/db";
import { randomToken } from "@/lib/password";
import { HttpError } from "@/lib/api";
import type { Invite } from "@/generated/prisma";

const INVITE_DAYS = 14;

export async function findValidInvite(token: string): Promise<Invite | null> {
  const invite = await db.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "pending" || invite.expiresAt < new Date()) return null;
  return invite;
}

export async function createInvite(opts: {
  kind: "workspace" | "account";
  invitedById: string;
  workspaceId?: string | null;
  email?: string | null;
  role?: "admin" | "member";
  boardAccess?: { boardId: string; level: string }[];
}) {
  const token = randomToken();
  const invite = await db.invite.create({
    data: {
      token,
      kind: opts.kind,
      role: opts.role ?? "member",
      workspaceId: opts.kind === "workspace" ? opts.workspaceId ?? null : null,
      email: opts.email || null,
      boardAccess: opts.boardAccess?.length ? JSON.stringify(opts.boardAccess) : null,
      invitedById: opts.invitedById,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
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

export async function markInviteAccepted(inviteId: string, userId: string) {
  await db.invite.update({ where: { id: inviteId }, data: { status: "accepted", acceptedById: userId } });
}
