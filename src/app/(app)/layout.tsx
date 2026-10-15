import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { addDays, startOfDay } from "@/lib/notes-schedule";
import { countNotesAttention } from "@/lib/notes-badge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();

  const startTomorrow = addDays(startOfDay(new Date()), 1);
  const [boards, badgeNotes, dueTickets] = await Promise.all([
    db.board.findMany({
      where: boardWhereForContext(ctx),
      orderBy: { position: "asc" },
      select: { id: true, name: true, slug: true, color: true },
    }),
    // Candidate notes for the badge; countNotesAttention applies the exact
    // Today semantics (due today or overdue, not done).
    db.note.findMany({
      where: {
        userId: ctx.user.id,
        deletedAt: null,
        doneOn: null,
        status: { in: ["inbox", "queued"] },
        scheduledDay: { not: null },
      },
      select: { status: true, scheduledDay: true, bucket: true, doneOn: true },
    }),
    db.ticket.findMany({
      where: {
        deletedAt: null,
        dueDate: { lt: startTomorrow },
        board: boardWhereForContext(ctx),
        column: { isDone: false },
      },
      select: { dueDate: true },
    }),
  ]);

  const todayCount = countNotesAttention({
    notes: badgeNotes,
    reflections: dueTickets.map((t) => ({ dueDate: t.dueDate!, done: false })),
  });

  return (
    <ToastProvider>
      <AppShell
        boards={boards}
        syncScope={`${ctx.user.id}:${ctx.workspace.id}`}
        userName={ctx.user.name}
        userEmail={ctx.user.email}
        userAvatarUrl={ctx.user.avatarUrl}
        userAvatarColor={ctx.user.avatarColor}
        isManager={ctx.isManager}
        isSystemAdmin={ctx.isSystemAdmin}
        workspaces={ctx.memberships.map((m) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          role: m.role,
          active: m.workspace.id === ctx.workspace.id,
        }))}
        todayCount={todayCount}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
