import Link from "next/link";
import { ThemedArt } from "@/components/ui/themed-art";
import type { Metadata } from "next";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { type UserLite } from "@/lib/serialize";
import { isTaskNote, loadTicketModal, ticketRowInclude, toNoteRow, toTicketRow } from "@/lib/services/task-rows";
import { listNotesForUser } from "@/lib/services/notes";
import { listActivity, TASK_ACTIONS } from "@/lib/services/activity-feed";
import { parseUserSettings } from "@/lib/user-settings";
import { startOfDay } from "@/lib/notes-schedule";
import { greetingFor, summaryLine, buildToday } from "@/lib/today-model";
import { TodayHero } from "@/components/today/today-hero";
import { TodayView, type TodayBoard } from "@/components/today/today-view";
import { TodayTicketModal } from "@/components/today/today-ticket-modal";
import { RecentChanges } from "@/components/today/recent-changes";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

type SearchParams = { ticket?: string; focus?: string; compose?: string };

export default async function TodayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { dictationLanguage } = parseUserSettings(ctx.user.settings);
  const boardWhere = boardWhereForContext(ctx);
  const startToday = startOfDay(new Date());

  // Board-scoped feed rows are capped to the boards this user can see.
  const visibleBoardIds = ctx.isManager ? null : (await db.board.findMany({ where: boardWhere, select: { id: true } })).map((b) => b.id);

  const [members, boardRows, openTickets, doneTodayTickets, notes, agents, changes] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: true } }),
    db.board.findMany({
      where: boardWhere,
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true, stage: true } },
      },
    }),
    // Every open, dated ticket the user can see — Today decides which day it belongs to.
    db.ticket.findMany({
      where: { board: boardWhere, column: { isDone: false }, deletedAt: null, dueDate: { not: null } },
      include: ticketRowInclude,
      orderBy: { dueDate: "asc" },
    }),
    // Finished today (any due date) — the "Done today" shelf.
    db.ticket.findMany({
      where: { board: boardWhere, column: { isDone: true }, deletedAt: null, completedAt: { gte: startToday } },
      include: ticketRowInclude,
      orderBy: { completedAt: "desc" },
      take: 50,
    }),
    listNotesForUser(ctx.user.id),
    db.agent.findMany({
      where: { workspaceId: ctx.workspace.id, status: "active" },
      select: { id: true, name: true, color: true, kind: true, ownerUserId: true, lastSeenAt: true, ownerUser: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    listActivity({ workspaceId: ctx.workspace.id, limit: 60, actions: TASK_ACTIONS, boardIds: visibleBoardIds, noteUserId: ctx.user.id }).catch(() => []),
  ]);

  const usersById = new Map<string, UserLite>(
    members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl, avatarColor: m.user.avatarColor }]),
  );
  const boards: TodayBoard[] = boardRows.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    color: b.color,
    columns: b.columns.map((c) => ({ id: c.id, name: c.name, isDone: c.isDone, stage: c.stage })),
  }));
  const doneColumnByBoard = new Map(boardRows.map((b) => [b.id, b.columns.find((c) => c.isDone)?.id ?? null]));

  const toRow = (t: (typeof openTickets)[number]) => toTicketRow(t, usersById, doneColumnByBoard);
  const tickets = [...openTickets.map(toRow), ...doneTodayTickets.map(toRow)];
  const todayNotes = notes.filter(isTaskNote).map(toNoteRow);

  const now = new Date();
  const model = buildToday({ tickets, notes: todayNotes, now });
  const { greeting, period } = greetingFor(now, ctx.user.name);
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ?ticket= opens the board modal on top of the list.
  const modal = await loadTicketModal(sp.ticket, boardWhere, usersById);

  const agent = agents[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-10 md:px-8 md:pt-8">
      <TodayHero name={ctx.user.name} period={period} greeting={greeting} dateLabel={dateLabel} summary={summaryLine(model.counts)} />

      <div className="mt-6 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <TodayView syncScope={`${ctx.user.id}:${ctx.workspace.id}`} tickets={tickets} notes={todayNotes} boards={boards} dictationLanguage={dictationLanguage} focusId={sp.focus ?? null} compose={sp.compose === "1"} initialNow={now.toISOString()} />

        <aside className="min-w-0 space-y-5 lg:pt-1">
          {/* Agent */}
          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center gap-3 px-4 pt-4">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                <ThemedArt name="agent" sizes="44px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[1.1rem] font-medium leading-tight">{agent ? agent.name : "Your agent"}</div>
                <div className="truncate text-xs text-fg-subtle">
                  {agent
                    ? agent.lastSeenAt
                      ? `Last seen ${timeAgoLabel(agent.lastSeenAt)}`
                      : "Connected · not seen yet"
                    : "Not connected yet"}
                </div>
              </div>
              {ctx.isManager && (
                <Link href="/agents" className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Agent settings">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>
            {/* What it did lives in Recent changes (Agent filter) — no second list here. */}
            {agent ? (
              <div className="pb-4" />
            ) : (
              <p className="px-4 pb-4 pt-2.5 text-xs text-fg-subtle">Connect an agent to let it add and complete tasks for you.</p>
            )}
          </section>

          <RecentChanges items={changes} currentUserId={ctx.user.id} />

          {!agent && ctx.isManager && (
            <Link href="/agents" className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Sparkles className="h-4 w-4" /> Connect an agent
            </Link>
          )}
        </aside>
      </div>

      {modal && (
        <TodayTicketModal
          ticket={modal.ticket}
          columns={modal.columns}
          labels={modal.labels}
          agents={agents.map(({ ownerUser, ...a }) => ({ id: a.id, name: a.name, color: a.color, kind: a.kind, ownerUserId: a.ownerUserId, ownerName: ownerUser?.name ?? null }))}
          members={modal.members}
          currentUser={{ id: ctx.user.id, name: ctx.user.name }}
        />
      )}
    </div>
  );
}

function timeAgoLabel(d: Date): string {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
