import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { MembersManager } from "@/components/members/members-manager";

export const metadata: Metadata = { title: "Members" };
export const dynamic = "force-dynamic";

const roleRank: Record<string, number> = { owner: 0, admin: 1, member: 2 };

export default async function MembersPage() {
  const ctx = await getContext();
  if (!ctx.isManager) redirect("/my-day");

  const [members, boards, invites, access] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: true } }),
    db.board.findMany({
      where: { workspaceId: ctx.workspace.id, archived: false },
      orderBy: { position: "asc" },
      select: { id: true, name: true, color: true },
    }),
    db.invite.findMany({
      where: { workspaceId: ctx.workspace.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
    db.boardAccess.findMany({
      where: { board: { workspaceId: ctx.workspace.id } },
      select: { userId: true, boardId: true, level: true },
    }),
  ]);

  const accessByUser = new Map<string, { boardId: string; level: string }[]>();
  for (const a of access) {
    const arr = accessByUser.get(a.userId) ?? [];
    arr.push({ boardId: a.boardId, level: a.level });
    accessByUser.set(a.userId, arr);
  }

  const memberRows = members
    .slice()
    .sort((a, b) => (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9))
    .map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      avatarColor: m.user.avatarColor,
      role: m.role,
      isOwner: m.role === "owner",
      isSelf: m.userId === ctx.user.id,
      access: accessByUser.get(m.userId) ?? [],
    }));

  return (
    <MembersManager
      members={memberRows}
      boards={boards}
      invites={invites.map((i) => ({
        id: i.id,
        token: i.token,
        email: i.email,
        kind: i.kind,
        role: i.role,
        createdAt: i.createdAt.toISOString(),
      }))}
      workspaceName={ctx.workspace.name}
    />
  );
}
