import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, CalendarClock, CheckCircle2, CircleDashed, NotebookPen, Sparkles, Target } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { ticketInclude, serializeTicket, type UserLite } from "@/lib/serialize";
import { dueMeta, priorityMeta } from "@/lib/display";
import { buildMyDayFocusItems, countMyDayUnsortedNotes, getMyDayTicketBuckets, type MyDayNote } from "@/lib/my-day";
import { Badge, tone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

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

  const [tickets, notes] = await Promise.all([
    db.ticket.findMany({
      where: { board: boardScope, column: { isDone: false }, deletedAt: null },
      include: { ...ticketInclude, board: { select: { slug: true, name: true, color: true } } },
      orderBy: { dueDate: "asc" },
    }),
    db.note.findMany({
      where: { userId: ctx.user.id, deletedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        body: true,
        status: true,
        scheduledDay: true,
        bucket: true,
        doneOn: true,
        position: true,
        createdAt: true,
      },
    }),
  ]);

  const rows: Row[] = tickets.map((t) => ({
    ...serializeTicket(t, usersById),
    boardSlug: t.board.slug,
    boardName: t.board.name,
    boardColor: t.board.color,
  }));
  const todayNotes: MyDayNote[] = notes.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }));

  const now = new Date();
  const { overdue, week } = getMyDayTicketBuckets(rows, now, ctx.user.id);
  const focus = buildMyDayFocusItems({ now, tickets: rows, notes: todayNotes, userId: ctx.user.id });
  const inboxCount = countMyDayUnsortedNotes({ now, notes: todayNotes });
  const onDeck = week.slice(0, 6);
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const doneToday = 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="relative overflow-hidden rounded-[2rem] border border-border bg-[radial-gradient(circle_at_top_left,var(--color-primary-soft),transparent_34%),linear-gradient(135deg,var(--color-surface),var(--color-surface-2))] p-5 shadow-card md:p-7">
        <div className="absolute right-6 top-6 h-28 w-28 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-soft/45 px-3 py-1 text-xs font-semibold text-primary-soft-fg">
              <Target className="h-3.5 w-3.5" /> Focus Mode
            </div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Today’s execution lane</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">
              {dateLabel}. Pick the few tickets and notes that matter now; everything else stays quietly on deck.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Now" value={focus.length} />
            <Stat label="Overdue" value={overdue.length} alert={overdue.length > 0} />
            <Stat label="Done" value={doneToday} />
          </div>
        </div>
      </header>

      {inboxCount > 0 && (
        <Link
          href="/notes"
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/55 px-3 py-1.5 text-xs text-fg-subtle transition-colors hover:border-primary/30 hover:text-fg-muted"
        >
          <NotebookPen className="h-3.5 w-3.5" />
          {inboxCount} unsorted {inboxCount === 1 ? "note" : "notes"} waiting quietly
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-[1.75rem] border border-border bg-surface/65 p-3 shadow-card md:p-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">Do next</h2>
              <p className="text-xs text-fg-subtle">Overdue and due-today tickets, today notes, then assigned work.</p>
            </div>
            <CircleDashed className="h-5 w-5 text-fg-subtle" />
          </div>
          {focus.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-border bg-surface-2/35 text-center">
              <div>
                <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary" />
                <h3 className="font-semibold">Clear lane</h3>
                <p className="mt-1 text-sm text-fg-muted">No urgent execution items. Pull from on deck or capture a note when something appears.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {focus.map((item, i) =>
                item.kind === "ticket" ? (
                  <FocusCard key={`ticket-${item.id}`} row={item.ticket} index={i + 1} urgent={item.urgent} />
                ) : (
                  <FocusNoteCard key={`note-${item.id}`} note={item.note} index={i + 1} />
                ),
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-border bg-surface/55 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">On deck</h2>
            <div className="space-y-2">
              {onDeck.length ? onDeck.map((r) => <DeckRow key={r.id} row={r} />) : <p className="text-sm text-fg-subtle">No dated tickets later this week.</p>}
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-surface/40 p-4 text-sm text-fg-muted">
            <div className="mb-2 flex items-center gap-2 font-medium text-fg">
              <CheckCircle2 className="h-4 w-4 text-success" /> Focus rule
            </div>
            Keep this lane small. Use Notes for capture and Boards for management; My Day is only for execution.
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/70 px-4 py-3 shadow-sm">
      <div className={alert ? "text-2xl font-bold text-danger" : "text-2xl font-bold"}>{value}</div>
      <div className="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">{label}</div>
    </div>
  );
}

function FocusCard({ row, index, urgent }: { row: Row; index: number; urgent?: boolean }) {
  const pr = priorityMeta(row.priority);
  const d = dueMeta(row.dueDate);
  return (
    <Link
      href={`/boards/${row.boardSlug}?ticket=${row.id}`}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
    >
      <span className={urgent ? "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger" : "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"}>
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold leading-snug">{row.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(row.boardColor).dot }} />
            {row.boardName}
          </span>
          <span>{row.column}</span>
          {row.priority !== "none" && <span style={{ color: pr.color }}>{pr.label}</span>}
        </div>
      </div>
      {d && (
        <Badge tone={d.tone}>
          <CalendarClock className="h-3 w-3" />
          {d.label}
        </Badge>
      )}
      {row.assignee && <Avatar name={row.assignee.name} color={row.assignee.type === "agent" ? row.assignee.color : undefined} isAgent={row.assignee.type === "agent"} size={26} />}
    </Link>
  );
}

function FocusNoteCard({ note, index }: { note: MyDayNote; index: number }) {
  return (
    <Link
      href="/notes"
      className="group flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary-soft/20 px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-primary">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-base font-semibold leading-snug">{note.body}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          <span className="inline-flex items-center gap-1 text-primary">
            <NotebookPen className="h-3.5 w-3.5" />
            Today note
          </span>
        </div>
      </div>
      <Badge tone="primary">Note</Badge>
    </Link>
  );
}

function DeckRow({ row }: { row: Row }) {
  const d = dueMeta(row.dueDate);
  return (
    <Link href={`/boards/${row.boardSlug}?ticket=${row.id}`} className="block rounded-xl border border-border/70 bg-surface/60 px-3 py-2 hover:bg-surface">
      <div className="line-clamp-2 text-sm font-medium">{row.title}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-subtle">
        <span>{row.boardName}</span>
        {d && <span>{d.label}</span>}
      </div>
    </Link>
  );
}
