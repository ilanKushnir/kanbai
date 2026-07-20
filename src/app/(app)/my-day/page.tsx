import Link from "next/link";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";
import { ArrowUpRight, CalendarClock, NotebookPen, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { ticketInclude, serializeTicket, type UserLite } from "@/lib/serialize";
import { updateNote } from "@/lib/services/notes";
import { moveTicketToDone } from "@/lib/services/tickets";
import { ymd } from "@/lib/notes-schedule";
import { HttpError } from "@/lib/api";
import { assertTicketAccess } from "@/lib/authz";
import { dueMeta, priorityMeta } from "@/lib/display";
import {
  buildMyDayCompletionSeries,
  buildMyDayDoneArchive,
  buildMyDayQueue,
  countMyDayUnsortedNotes,
  getMyDayTicketBuckets,
  myDayTicketScope,
  type MyDayDoneArchiveGroup,
  type MyDayFocusItem,
  type MyDayNote,
} from "@/lib/my-day";
import { Badge, tone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DoneButton } from "@/components/my-day/done-button";
import { MomentumChart } from "@/components/my-day/momentum-chart";

export const metadata: Metadata = { title: "My Day" };
export const dynamic = "force-dynamic";

async function markMyDayNoteDone(formData: FormData) {
  "use server";
  const ctx = await getContext();
  const noteId = String(formData.get("noteId") ?? "");
  if (!noteId) return;
  const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
  if (!note || note.userId !== ctx.user.id) throw new HttpError(404, "Note not found");
  await updateNote(noteId, { doneOn: ymd(new Date()) });
  revalidatePath("/my-day");
  revalidatePath("/notes");
}

async function markMyDayTicketDone(formData: FormData) {
  "use server";
  const ctx = await getContext();
  const ticketId = String(formData.get("ticketId") ?? "");
  if (!ticketId) return;
  try {
    await assertTicketAccess(ctx, ticketId, true);
    await moveTicketToDone(ticketId, { type: "user", id: ctx.user.id, name: ctx.user.name });
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 422 && error.message.includes("No done column"))) throw error;
  }
  revalidatePath("/my-day");
}

type Row = ReturnType<typeof serializeTicket> & {
  boardSlug: string;
  boardName: string;
  boardColor: string;
  doneColumnId: string | null;
};

export default async function MyDayPage() {
  const ctx = await getContext();

  const members = await db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: true } });
  const usersById = new Map<string, UserLite>(
    members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl, avatarColor: m.user.avatarColor }]),
  );

  const boardScope = ctx.isManager
    ? { workspaceId: ctx.workspace.id, archived: false }
    : { workspaceId: ctx.workspace.id, archived: false, access: { some: { userId: ctx.user.id } } };

  const [tickets, doneTickets, notes] = await Promise.all([
    db.ticket.findMany({
      where: { board: boardScope, column: { isDone: false }, deletedAt: null, ...myDayTicketScope(ctx.user.id) },
      include: { ...ticketInclude, board: { select: { slug: true, name: true, color: true, columns: { where: { isDone: true }, orderBy: { position: "asc" }, select: { id: true } } } } },
      orderBy: { dueDate: "asc" },
    }),
    db.ticket.findMany({
      where: { board: boardScope, column: { isDone: true }, deletedAt: null, ...myDayTicketScope(ctx.user.id) },
      include: { ...ticketInclude, board: { select: { slug: true, name: true, color: true, columns: { where: { isDone: true }, orderBy: { position: "asc" }, select: { id: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 60,
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

  const toRow = (t: typeof tickets[number]): Row => ({
    ...serializeTicket(t, usersById),
    boardSlug: t.board.slug,
    boardName: t.board.name,
    boardColor: t.board.color,
    doneColumnId: t.board.columns[0]?.id ?? null,
  });
  const rows: Row[] = tickets.map(toRow);
  const doneRows: Row[] = doneTickets.map((t) => ({ ...toRow(t), completedOn: ymd(t.updatedAt) }));
  const todayNotes: MyDayNote[] = notes.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }));

  const now = new Date();
  const { week } = getMyDayTicketBuckets(rows, now, ctx.user.id);
  const queue = buildMyDayQueue({ now, tickets: rows, notes: todayNotes, userId: ctx.user.id });
  const unsortedCount = countMyDayUnsortedNotes({ now, notes: todayNotes });
  const onDeck = week.slice(0, 6);
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const doneArchive = buildMyDayDoneArchive({ now, tickets: doneRows, notes: todayNotes, limit: 12 });
  const doneToday = doneArchive.groups.find((group) => group.key === ymd(now))?.items.length ?? 0;

  // Real progress: what's already done today against what still has to move today.
  const remaining = queue.overdue.length + queue.today.length;
  const dayTotal = doneToday + remaining;
  const pct = dayTotal > 0 ? Math.round((doneToday / dayTotal) * 100) : 0;
  const queueEmpty = remaining + queue.anytime.length === 0;
  const momentum = buildMyDayCompletionSeries({ now, tickets: doneRows, notes: todayNotes, days: 14 });

  // One continuous execution order across the groups: overdue first, then today.
  const todayOffset = queue.overdue.length;
  const anytimeOffset = todayOffset + queue.today.length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:px-6 md:pb-8 md:pt-8">
      {/* The header's right track mirrors the body grid below (20rem + gap-6)
          so the momentum chart sits flush over the "On deck" aside. */}
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6 lg:items-stretch">
        {/* The day's command surface: same inverted-iris capture language as
            the Notes composer, restated as "here is your plan". */}
        <div className="kb-day-hero flex flex-col rounded-3xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/60">{dateLabel}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-white md:text-3xl">My Day</h1>
              <p className="mt-1.5 text-sm text-white/75">
                {remaining === 0
                  ? doneToday > 0
                    ? "Everything due today is done."
                    : "Nothing is due today."
                  : `${remaining} ${remaining === 1 ? "item" : "items"} to clear today.`}
              </p>
            </div>
            <DayRing done={doneToday} total={dayTotal} pct={pct} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 lg:mt-auto lg:pt-5">
            <HeroStat label="Overdue" value={queue.overdue.length} dot="#ff6f86" emphasize={queue.overdue.length > 0} />
            <HeroStat label="Due today" value={queue.today.length} dot="#34d6ee" />
            <HeroStat label="Done" value={doneToday} dot="#32da98" emphasize={doneToday > 0} />
          </div>
        </div>

        <MomentumChart series={momentum} />
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {queueEmpty ? (
            <section className="grid min-h-64 place-items-center rounded-3xl border border-dashed border-border bg-surface-2/35 p-6 text-center shadow-card">
              <div>
                <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary" />
                <h2 className="font-semibold">Clear lane</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Nothing is due or overdue. Pull something from on deck, or capture a note when work appears.
                </p>
              </div>
            </section>
          ) : (
            <>
              {queue.overdue.length > 0 && (
                <QueueGroup
                  title="Overdue"
                  count={queue.overdue.length}
                  tone="danger"
                  hint="Slipped past their day — finish or reschedule."
                >
                  {queue.overdue.map((item, i) => (
                    <QueueItem key={`${item.kind}-${item.id}`} item={item} index={i + 1} upNext={i === 0} />
                  ))}
                </QueueGroup>
              )}
              {queue.today.length > 0 && (
                <QueueGroup title="Today" count={queue.today.length} tone="default" hint="Due today — tickets first, then your notes.">
                  {queue.today.map((item, i) => (
                    <QueueItem
                      key={`${item.kind}-${item.id}`}
                      item={item}
                      index={todayOffset + i + 1}
                      upNext={todayOffset === 0 && i === 0}
                    />
                  ))}
                </QueueGroup>
              )}
              {queue.anytime.length > 0 && (
                <QueueGroup title="Anytime" count={queue.anytime.length} tone="default" hint="Assigned to you, no due date.">
                  {queue.anytime.map((item, i) => (
                    <QueueItem key={`${item.kind}-${item.id}`} item={item} index={anytimeOffset + i + 1} />
                  ))}
                </QueueGroup>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-border bg-surface/60 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">On deck this week</h2>
            <div className="space-y-2">
              {onDeck.length ? onDeck.map((r) => <DeckRow key={r.id} row={r} />) : <p className="text-sm text-fg-subtle">No dated tickets later this week.</p>}
            </div>
          </section>
          <DoneArchive archive={doneArchive} />
          {unsortedCount > 0 && (
            <Link
              href="/notes"
              className="flex items-center gap-2 rounded-2xl border border-border bg-surface/55 px-4 py-3 text-xs text-fg-subtle transition-colors hover:border-primary/30 hover:text-fg-muted"
            >
              <NotebookPen className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                {unsortedCount} unsorted {unsortedCount === 1 ? "note" : "notes"} waiting in Notes
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A quiet chip on the hero: colored dot carries identity, text stays white. */
function HeroStat({ label, value, dot, emphasize }: { label: string; value: number; dot: string; emphasize?: boolean }) {
  return (
    <span
      className={
        emphasize
          ? "inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-xs font-medium text-white"
          : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80"
      }
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {label}
      <span className="font-bold tabular-nums text-white">{value}</span>
    </span>
  );
}

/**
 * Today's progress as a ring: done ÷ (done + still due today). Empty days show
 * a calm sparkle instead of a meaningless 0%.
 */
function DayRing({ done, total, pct }: { done: number; total: number; pct: number }) {
  const size = 92;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  if (total === 0) {
    return (
      <div className="grid h-[5.75rem] w-[5.75rem] shrink-0 place-items-center rounded-full border border-white/15 bg-white/10">
        <Sparkles className="h-7 w-7 text-white/80" />
      </div>
    );
  }
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`Today's progress: ${done} of ${total} done`}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#34d6ee"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-lg font-bold leading-none text-white">{pct}%</div>
          <div className="mt-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-white/60">done</div>
        </div>
      </div>
    </div>
  );
}

function QueueGroup({
  title,
  count,
  tone: groupTone,
  hint,
  children,
}: {
  title: string;
  count: number;
  tone: "danger" | "default";
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-surface/60 p-3 shadow-card md:p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2
          className={
            groupTone === "danger"
              ? "text-sm font-semibold uppercase tracking-wider text-danger"
              : "text-sm font-semibold uppercase tracking-wider text-fg-muted"
          }
        >
          {title}
        </h2>
        <span
          className={
            groupTone === "danger"
              ? "rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-danger"
              : "rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-fg-muted"
          }
        >
          {count}
        </span>
        <p className="ms-auto hidden text-xs text-fg-subtle sm:block">{hint}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function QueueItem({ item, index, upNext }: { item: MyDayFocusItem<Row, MyDayNote>; index: number; upNext?: boolean }) {
  return item.kind === "ticket" ? (
    <FocusCard row={item.ticket} index={index} urgent={item.urgent} upNext={upNext} />
  ) : (
    <FocusNoteCard note={item.note} index={index} upNext={upNext} />
  );
}

function FocusCard({ row, index, urgent, upNext }: { row: Row; index: number; urgent?: boolean; upNext?: boolean }) {
  const pr = priorityMeta(row.priority);
  const d = dueMeta(row.dueDate);
  return (
    <div className="group rounded-2xl border border-border bg-surface px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md">
      <Link href={`/boards/${row.boardSlug}?ticket=${row.id}`} className="flex min-w-0 items-start gap-3">
        <span className={urgent ? "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger" : "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"}>
          {index}
        </span>
        <div className="min-w-0 flex-1 text-start" dir="auto">
          <div className="text-base font-semibold leading-snug break-words">{row.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(row.boardColor).dot }} />
              {row.boardName}
            </span>
            <span>{row.column}</span>
            {row.priority !== "none" && <span style={{ color: pr.color }}>{pr.label}</span>}
          </div>
        </div>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        {upNext && <Badge tone="primary">Up next</Badge>}
        {d && (
          <Badge tone={d.tone}>
            <CalendarClock className="h-3 w-3" />
            {d.label}
          </Badge>
        )}
        <Badge tone="default">Ticket</Badge>
        {row.assignee && <Avatar name={row.assignee.name} color={row.assignee.color} src={row.assignee.type === "user" ? row.assignee.avatarUrl : undefined} isAgent={row.assignee.type === "agent"} size={26} />}
        <form action={markMyDayTicketDone} className="ml-auto">
          <input type="hidden" name="ticketId" value={row.id} />
          <DoneControl disabled={!row.doneColumnId} title={row.doneColumnId ? "Mark ticket done" : "No done column configured"} />
          <span className="sr-only">Done</span>
        </form>
      </div>
    </div>
  );
}

function FocusNoteCard({ note, index, upNext }: { note: MyDayNote; index: number; upNext?: boolean }) {
  return (
    <div className="group rounded-2xl border border-primary/20 bg-primary-soft/20 px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md">
      <Link href={`/notes?focus=${note.id}`} className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-primary">
          {index}
        </span>
        <div className="min-w-0 flex-1 text-start" dir="auto">
          <div className="line-clamp-3 text-base font-semibold leading-snug break-words">{note.body}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1 text-primary">
              <NotebookPen className="h-3.5 w-3.5" />
              Today note
            </span>
          </div>
        </div>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        {upNext && <Badge tone="primary">Up next</Badge>}
        <Badge tone="primary">Note</Badge>
        <form action={markMyDayNoteDone} className="ml-auto">
          <input type="hidden" name="noteId" value={note.id} />
          <DoneControl title="Mark note done" />
        </form>
      </div>
    </div>
  );
}


function DoneControl({ disabled, title }: { disabled?: boolean; title: string }) {
  return (
    <DoneButton
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-success bg-transparent px-2.5 py-1.5 text-xs font-semibold text-success shadow-sm transition-colors hover:bg-success hover:text-success-fg focus:bg-success focus:text-success-fg active:bg-success active:text-success-fg disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-subtle disabled:shadow-none"
    />
  );
}

function DoneArchive({ archive }: { archive: { total: number; hasMore: boolean; groups: MyDayDoneArchiveGroup<Row, MyDayNote>[] } }) {
  return (
    <details className="rounded-2xl border border-border bg-surface/60 p-4">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        Done archive · {archive.total}
      </summary>
      <div className="mt-3 space-y-3">
        {archive.groups.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nothing completed yet.</p>
        ) : (
          archive.groups.map((group) => (
            <div key={group.key}>
              <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">{group.label}</div>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="rounded-xl border border-success/20 bg-success-soft/35 px-3 py-2 text-sm">
                    <div dir="auto" className="line-clamp-2 font-medium text-fg">{item.kind === "ticket" ? item.ticket.title : item.note.body}</div>
                    <div className="mt-1 text-xs text-success">{item.kind === "ticket" ? "Ticket" : "Note"} · done</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        {archive.hasMore && <div className="text-xs text-fg-subtle">Older completed items live on their boards.</div>}
      </div>
    </details>
  );
}

function DeckRow({ row }: { row: Row }) {
  const d = dueMeta(row.dueDate);
  return (
    <Link href={`/boards/${row.boardSlug}?ticket=${row.id}`} className="block rounded-xl border border-border/70 bg-surface/60 px-3 py-2 hover:bg-surface">
      <div dir="auto" className="line-clamp-2 text-sm font-medium">{row.title}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-subtle">
        <span>{row.boardName}</span>
        {d && <span>{d.label}</span>}
      </div>
    </Link>
  );
}
