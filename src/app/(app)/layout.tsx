import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();

  const [boards, inboxCount] = await Promise.all([
    db.board.findMany({
      where: boardWhereForContext(ctx),
      orderBy: { position: "asc" },
      select: { id: true, name: true, slug: true, color: true },
    }),
    db.note.count({ where: { userId: ctx.user.id, status: "inbox" } }),
  ]);

  return (
    <ToastProvider>
      <ServiceWorkerRegister />
      <AppShell
        boards={boards}
        userName={ctx.user.name}
        userEmail={ctx.user.email}
        isManager={ctx.isManager}
        isSystemAdmin={ctx.isSystemAdmin}
        workspaces={ctx.memberships.map((m) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          role: m.role,
          active: m.workspace.id === ctx.workspace.id,
        }))}
        inboxCount={inboxCount}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
