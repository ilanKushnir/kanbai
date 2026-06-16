import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { workspace, user } = await getCurrentContext();

  const [boards, inboxCount] = await Promise.all([
    db.board.findMany({
      where: { workspaceId: workspace.id, archived: false },
      orderBy: { position: "asc" },
      select: { id: true, name: true, slug: true, color: true },
    }),
    db.note.count({ where: { userId: user.id, status: "inbox" } }),
  ]);

  return (
    <ToastProvider>
      <AppShell
        boards={boards}
        workspaceName={workspace.name}
        userName={user?.name ?? "You"}
        inboxCount={inboxCount}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
