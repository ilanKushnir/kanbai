import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { addDays, startOfDay } from "@/lib/notes-schedule";
import { countNotesAttention } from "@/lib/notes-badge";
import { ticketOwnership, type TodayAssignee } from "@/lib/today-model";
import { parseUserSettings } from "@/lib/user-settings";
import { WhatsNew } from "@/components/whats-new";
import { LATEST_RELEASE_VERSION } from "@/lib/changelog";
import { listNotifications, notificationScope } from "@/lib/services/notifications";
import { cookies } from "next/headers";
import { FOCUS_COOKIE } from "@/lib/focus";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const focus = (await cookies()).get(FOCUS_COOKIE)?.value === "1";

  const startTomorrow = addDays(startOfDay(new Date()), 1);
  const [boards, badgeNotes, dueTickets, notifications] = await Promise.all([
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
        status: "inbox",
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
      select: {
        dueDate: true,
        assigneeType: true,
        assigneeUserId: true,
        assignees: { select: { userId: true } },
        agent: { select: { id: true, ownerUserId: true } },
      },
    }),
    listNotifications(ctx.user.id, notificationScope(ctx)),
  ]);
  const whatsNewSeen = parseUserSettings(ctx.user.settings).whatsNewSeen;

  const todayCount = countNotesAttention({
    notes: badgeNotes,
    // Same rule as the Today list: someone else's tickets don't count.
    reflections: dueTickets
      .filter((t) => ticketOwnership(badgeAssignees(t), ctx.user.id) !== "others")
      .map((t) => ({ dueDate: t.dueDate!, done: false })),
  });

  return (
    <ToastProvider>
      <AppShell
        boards={boards}
        syncScope={`${ctx.user.id}:${ctx.workspace.id}`}
        userId={ctx.user.id}
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
        initialFocus={focus}
        notifications={notifications}
        activeWorkspaceId={ctx.workspace.id}
        holdNotifications={whatsNewSeen !== LATEST_RELEASE_VERSION}
      >
        {children}
      </AppShell>
      <WhatsNew seenVersion={whatsNewSeen} />
    </ToastProvider>
  );
}

/** Just enough of a ticket's assignees to tell whose it is. */
function badgeAssignees(t: {
  assigneeType: string | null;
  assigneeUserId: string | null;
  assignees: { userId: string }[];
  agent: { id: string; ownerUserId: string | null } | null;
}): TodayAssignee[] {
  if (t.assigneeType === "agent") return t.agent ? [{ type: "agent", id: t.agent.id, name: "", ownerUserId: t.agent.ownerUserId }] : [];
  if (t.assigneeType !== "user") return [];
  const ids = t.assignees.length ? t.assignees.map((a) => a.userId) : t.assigneeUserId ? [t.assigneeUserId] : [];
  return ids.map((id) => ({ type: "user", id, name: "" }));
}
