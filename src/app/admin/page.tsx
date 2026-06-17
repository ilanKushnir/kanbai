import type { Metadata } from "next";
import { requireSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = { title: "Global admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await requireSystemAdmin();

  const [users, workspaces, userCount, wsCount, boardCount, ticketCount, noteCount, agentCount] =
    await Promise.all([
      db.user.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, systemRole: true, status: true, createdAt: true },
      }),
      db.workspace.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          owner: { select: { name: true, email: true } },
          _count: { select: { members: true, boards: true } },
        },
      }),
      db.user.count(),
      db.workspace.count(),
      db.board.count(),
      db.ticket.count(),
      db.note.count(),
      db.agent.count(),
    ]);

  return (
    <AdminDashboard
      currentUserId={me.id}
      stats={{
        users: userCount,
        workspaces: wsCount,
        boards: boardCount,
        tickets: ticketCount,
        notes: noteCount,
        agents: agentCount,
      }}
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        systemRole: u.systemRole,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
      }))}
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        ownerName: w.owner?.name ?? "—",
        ownerEmail: w.owner?.email ?? "",
        members: w._count.members,
        boards: w._count.boards,
        createdAt: w.createdAt.toISOString(),
      }))}
    />
  );
}
