import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { ticketInclude, serializeTicket, type UserLite } from "@/lib/serialize";
import { listNotesForUser } from "@/lib/services/notes";
import { boardAssigneeUsers } from "@/lib/services/board-members";
import { listActivity } from "@/lib/services/activity-feed";
import { parseSubStates } from "@/lib/substates";
import { parseUserSettings } from "@/lib/user-settings";
import { startOfDay } from "@/lib/notes-schedule";
import { greetingFor, summaryLine, buildToday, type TodayTicket, type TodayNote } from "@/lib/today-model";
import { tone } from "@/components/ui/badge";
import { TodayHero } from "@/components/today/today-hero";
import { TodayView, type TodayBoard } from "@/components/today/today-view";
import { TodayTicketModal } from "@/components/today/today-ticket-modal";
import { ActivityList } from "@/components/activity/activity-list";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

type SearchParams = { ticket?: string; focus?: string; compose?: string };

export default async function TodayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { dictationLanguage } = parseUserSettings(ctx.user.settings);
  const boardWhere = boardWhereForContext(ctx);
  const startToday = startOfDay(new Date());

  const [members, boardRows, openTickets, doneTodayTickets, notes, agents, activity] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: true } }),
    db.board.findMany({
      where: boardWhere,
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true, stage: true, _count: { select: { tickets: { where: { deletedAt: null } } } } } },
      },
    }),
    // Every open, dated ticket the user can see — Today decides which day it belongs to.
    db.ticket.findMany({
      where: { board: boardWhere, column: { isDone: false }, deletedAt: null, dueDate: { not: null } },
      include: { ...ticketInclude, board: { select: { id: true, slug: true, name: true, color: true } } },
      orderBy: { dueDate: "asc" },
    }),
    // Finished today (any due date) — the "Done today" shelf.
    db.ticket.findMany({
      where: { board: boardWhere, column: { isDone: true }, deletedAt: null, completedAt: { gte: startToday } },
      include: { ...ticketInclude, board: { select: { id: true, slug: true, name: true, color: true } } },
      orderBy: { completedAt: "desc" },
      take: 50,
    }),
    listNotesForUser(ctx.user.id),
    db.agent.findMany({
      where: { workspaceId: ctx.workspace.id, status: "active" },
      select: { id: true, name: true, color: true, kind: true, ownerUserId: true, lastSeenAt: true, ownerUser: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    listActivity({ workspaceId: ctx.workspace.id, limit: 8, actorType: "agent" }).catch(() => []),
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

  const toRow = (t: (typeof openTickets)[number]): TodayTicket => {
    const s = serializeTicket(t, usersById);
    return {
      id: s.id,
      title: s.title,
      number: s.number,
      priority: s.priority,
      dueDate: s.dueDate,
      columnId: s.columnId,
      columnName: s.column ?? "",
      subState: s.subState,
      completedAt: s.completedAt,
      isDone: s.isDone,
      board: { id: t.board.id, name: t.board.name, slug: t.board.slug, color: t.board.color, doneColumnId: doneColumnByBoard.get(t.board.id) ?? null },
      labels: s.labels,
      subtasksDone: s.subtasks.filter((x) => x.completed).length,
      subtasksTotal: s.subtasks.length,
      commentCount: s.commentCount,
      createdByType: s.createdBy.type,
      createdAt: s.createdAt,
    };
  };
  const tickets = [...openTickets.map(toRow), ...doneTodayTickets.map(toRow)];
  const todayNotes: TodayNote[] = notes
    .filter((n) => n.status === "inbox" || n.status === "queued")
    .map((n) => ({
      id: n.id,
      body: n.body,
      status: n.status,
      scheduledDay: n.scheduledDay,
      doneOn: n.doneOn,
      priority: n.priority,
      position: n.position,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      assignedAgent: n.assignedAgent ? { id: n.assignedAgent.id, name: n.assignedAgent.name } : null,
      ticket: n.ticket,
    }));

  const now = new Date();
  const model = buildToday({ tickets, notes: todayNotes, now });
  const { greeting, period } = greetingFor(now, ctx.user.name);
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ?ticket= opens the board modal on top of the list.
  const modalTicket = sp.ticket
    ? await db.ticket.findFirst({ where: { id: sp.ticket, deletedAt: null, board: boardWhere }, include: ticketInclude })
    : null;
  const modalBoard = modalTicket
    ? await db.board.findFirst({
        where: { id: modalTicket.boardId },
        select: {
          columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true, subStates: true } },
          labels: { orderBy: { name: "asc" }, select: { id: true, name: true, color: true } },
        },
      })
    : null;
  const modalMembers = modalTicket ? await boardAssigneeUsers(modalTicket.boardId) : [];

  const agent = agents[0] ?? null;
  const boardStats = boardRows.map((b) => {
    const total = b.columns.reduce((s, c) => s + c._count.tickets, 0);
    const done = b.columns.filter((c) => c.isDone).reduce((s, c) => s + c._count.tickets, 0);
    return { id: b.id, name: b.name, slug: b.slug, color: b.color, total, done, open: total - done };
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-10 md:px-8 md:pt-8">
      <TodayHero period={period} greeting={greeting} dateLabel={dateLabel} summary={summaryLine(model.counts)} />

      <div className="mt-6 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <TodayView tickets={tickets} notes={todayNotes} boards={boards} dictationLanguage={dictationLanguage} focusId={sp.focus ?? null} compose={sp.compose === "1"} initialNow={now.toISOString()} />

        <aside className="min-w-0 space-y-5 lg:pt-1">
          {/* Agent */}
          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center gap-3 px-4 pt-4">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                <Image src="/art/agent.webp" alt="" fill sizes="44px" className="object-cover" />
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
            <div className="px-2 pb-2 pt-3">
              {activity.length === 0 ? (
                <p className="px-2 pb-2 text-xs text-fg-subtle">
                  {agent ? "Nothing yet today. Ask your agent to add, move or complete tasks — it shows up here." : "Connect an agent to let it add and complete tasks for you."}
                </p>
              ) : (
                <ActivityList items={activity} compact />
              )}
            </div>
          </section>

          {/* Projects */}
          <section className="rounded-2xl border border-border bg-surface px-2 py-2">
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <span className="font-display text-[1.1rem] font-medium">Boards</span>
              <Link href="/boards" className="text-xs text-fg-subtle hover:text-fg">All</Link>
            </div>
            {boardStats.length === 0 && <p className="px-2 pb-2 text-xs text-fg-subtle">No boards yet.</p>}
            {boardStats.map((b) => (
              <Link key={b.id} href={`/boards/${b.slug}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                <span className="min-w-0 flex-1 truncate" dir="auto">{b.name}</span>
                <span className="text-[0.6875rem] tabular-nums text-fg-subtle">{b.open} open</span>
              </Link>
            ))}
          </section>

          {!agent && ctx.isManager && (
            <Link href="/agents" className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Sparkles className="h-4 w-4" /> Connect an agent
            </Link>
          )}
        </aside>
      </div>

      {modalTicket && modalBoard && (
        <TodayTicketModal
          ticket={serializeTicket(modalTicket, usersById)}
          columns={modalBoard.columns.map((c) => ({ ...c, subStates: parseSubStates(c.subStates) }))}
          labels={modalBoard.labels}
          agents={agents.map(({ ownerUser, ...a }) => ({ id: a.id, name: a.name, color: a.color, kind: a.kind, ownerUserId: a.ownerUserId, ownerName: ownerUser?.name ?? null }))}
          members={modalMembers}
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
