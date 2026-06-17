import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock, NotebookPen, Sparkles, ArrowUpRight } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { ticketInclude, serializeTicket, type UserLite } from "@/lib/serialize";
import { dueMeta, priorityMeta } from "@/lib/display";
import { Badge, tone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "My Day" };
export const dynamic = "force-dynamic";

type Row = ReturnType<typeof serializeTicket> & {
  boardSlug: string;
  boardName: string;
  boardColor: string;
};

export default async function MyDayPage() {
  const ctx = await getContext();

  const members = await db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: true } });
  const usersById = new Map<string, UserLite>(
    members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl }]),
  );

  const boardScope = ctx.isManager
    ? { workspaceId: ctx.workspace.id, archived: false }
    : { workspaceId: ctx.workspace.id, archived: false, access: { some: { userId: ctx.user.id } } };

  const [tickets, inboxCount] = await Promise.all([
    db.ticket.findMany({
      where: { board: boardScope, column: { isDone: false } },
      include: { ...ticketInclude, board: { select: { slug: true, name: true, color: true } } },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    }),
    db.note.count({ where: { userId: ctx.user.id, status: "inbox" } }),
  ]);

  const rows: Row[] = tickets.map((t) => ({
    ...serializeTicket(t, usersById),
    boardSlug: t.board.slug,
    boardName: t.board.name,
    boardColor: t.board.color,
  }));

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endToday = startToday + 86400000 - 1;
  const endWeek = startToday + 7 * 86400000;
  const due = (r: Row) => (r.dueDate ? new Date(r.dueDate).getTime() : null);

  const overdue = rows.filter((r) => due(r) !== null && (due(r) as number) < startToday);
  const today = rows.filter((r) => due(r) !== null && (due(r) as number) >= startToday && (due(r) as number) <= endToday);
  const week = rows.filter((r) => due(r) !== null && (due(r) as number) > endToday && (due(r) as number) <= endWeek);
  const datedIds = new Set([...overdue, ...today, ...week].map((r) => r.id));
  const mine = rows.filter(
    (r) => !datedIds.has(r.id) && r.assignee?.type === "user" && r.assignee.id === ctx.user.id,
  );

  const total = overdue.length + today.length + week.length + mine.length;
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">My Day</h1>
        <p className="mt-1 text-sm text-fg-muted">{dateLabel}</p>
      </header>

      {inboxCount > 0 && (
        <Link
          href="/notes"
          className="mb-5 flex items-center gap-3 rounded-2xl border border-border bg-primary-soft/40 px-4 py-3 transition-colors hover:bg-primary-soft"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-fg">
            <NotebookPen className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {inboxCount} {inboxCount === 1 ? "note" : "notes"} to sort
            </div>
            <div className="text-xs text-fg-muted">Capture is piling up — file them into boards.</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-fg-subtle" />
        </Link>
      )}

      {total === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="You're all caught up"
          description="Nothing overdue or due this week. Capture a note or open a board when you're ready."
          className="mt-6"
        />
      ) : (
        <div className="space-y-6">
          <Section label="Overdue" tone="rose" rows={overdue} />
          <Section label="Today" tone="amber" rows={today} />
          <Section label="This week" tone="slate" rows={week} />
          <Section label="Assigned to you" tone="iris" rows={mine} />
        </div>
      )}
    </div>
  );
}

function Section({ label, tone: t, rows }: { label: string; tone: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(t).dot }} />
        {label}
        <span className="text-fg-subtle/70">{rows.length}</span>
      </h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <AgendaRow key={r.id} row={r} />
        ))}
      </div>
    </section>
  );
}

function AgendaRow({ row }: { row: Row }) {
  const pr = priorityMeta(row.priority);
  const d = dueMeta(row.dueDate);
  return (
    <Link
      href={`/boards/${row.boardSlug}?ticket=${row.id}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-card transition-all hover:border-border-strong hover:shadow-md"
    >
      {row.priority !== "none" && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pr.color }} title={pr.label} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(row.boardColor).dot }} />
            {row.boardName}
          </span>
          <span>·</span>
          <span>{row.column}</span>
        </div>
      </div>
      {d && (
        <Badge tone={d.tone}>
          <CalendarClock className="h-3 w-3" />
          {d.label}
        </Badge>
      )}
      {row.assignee && (
        <Avatar
          name={row.assignee.name}
          color={row.assignee.type === "agent" ? row.assignee.color : undefined}
          isAgent={row.assignee.type === "agent"}
          size={24}
        />
      )}
    </Link>
  );
}
