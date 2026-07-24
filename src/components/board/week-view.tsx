"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import { TicketModal } from "./ticket-modal";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { priorityMeta, assigneeLabel, canAssignAgent, cardAssignees } from "@/lib/display";
import { addDays, parseYmd, ymd } from "@/lib/notes-schedule";
import {
  buildWeekDays,
  groupTicketsByWeekDay,
  pagerSettleDelta,
  startOfWeek,
  weekPagerStarts,
  weekRangeLabel,
  weeksBetween,
} from "@/lib/week-view";
import type { BoardData } from "@/lib/services/boards";
import type { SerializedTicket } from "@/lib/serialize";

type AgentLite = {
  id: string;
  name: string;
  color: string;
  kind: string;
  /** Owned agents are only assignable by their owner; null = workspace agent. */
  ownerUserId: string | null;
  ownerName: string | null;
};
type MemberLite = { id: string; name: string; avatarUrl?: string | null; avatarColor?: string | null };

/** Undated tickets shown before the tray offers to reveal the rest. */
const UNSCHEDULED_VISIBLE_LIMIT = 10;

/** How long the pager must sit still before a page is considered settled. */
const PAGER_SETTLE_MS = 160;

function buildTicketsById(board: BoardData): Record<string, SerializedTicket> {
  const m: Record<string, SerializedTicket> = {};
  board.columns.forEach((c) => c.tickets.forEach((t) => (m[t.id] = t)));
  return m;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Per-board Week View: the board's tickets laid out as a weekly journal —
 * one bucket per local calendar day (by due date), plus a "No date" tray —
 * with previous/current/next week navigation. Weeks page horizontally with
 * native scroll-snap (swipe on touch, buttons/arrows elsewhere); each week
 * panel scrolls vertically on its own, so snap only ever means "next week",
 * never a hijacked day list. Read-and-open: tap a card for the full ticket
 * modal; scheduling stays on the due-date field there.
 */
export function WeekView({
  board,
  agents,
  members = [],
  currentUser,
  weekStartsOn = 0,
  switcher,
}: {
  board: BoardData;
  agents: AgentLite[];
  members?: MemberLite[];
  currentUser?: { id: string; name: string } | null;
  weekStartsOn?: number;
  switcher?: React.ReactNode;
}) {
  const router = useRouter();
  const [ticketsById, setTicketsById] = React.useState<Record<string, SerializedTicket>>(() =>
    buildTicketsById(board),
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [weekStart, setWeekStart] = React.useState<string>(() => ymd(startOfWeek(new Date(), weekStartsOn)));
  const [showAllUnscheduled, setShowAllUnscheduled] = React.useState(false);
  const [todayFlash, setTodayFlash] = React.useState(0);

  const pagerRef = React.useRef<HTMLDivElement>(null);
  const settleTimerRef = React.useRef<number | null>(null);
  const pendingTodayFocusRef = React.useRef(false);
  // Tickets deleted locally but possibly still present in a stale server board:
  // confirm() blurs the window, so the refocus revalidation can race the DELETE
  // and deliver a board that still carries the just-deleted ticket. Tombstoned
  // ids stay hidden until the server board no longer contains them.
  const [removedIds, setRemovedIds] = React.useState<ReadonlySet<string>>(new Set());

  // Server truth changed (focus revalidation, an agent filing tickets) →
  // rebuild, adjusting state during render (no effect round-trip). Tombstones
  // for boards that no longer carry the deleted ticket are dropped in the same
  // pass — the server has caught up, so a later restore may show it again.
  const [prevBoard, setPrevBoard] = React.useState(board);
  if (prevBoard !== board) {
    setPrevBoard(board);
    setTicketsById(buildTicketsById(board));
    if (removedIds.size > 0) {
      const serverIds = new Set<string>();
      board.columns.forEach((c) => c.tickets.forEach((t) => serverIds.add(t.id)));
      const next = new Set([...removedIds].filter((id) => serverIds.has(id)));
      if (next.size !== removedIds.size) setRemovedIds(next);
    }
  }

  // Keep an open board fresh: revalidate when the tab regains focus.
  React.useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const currentWeekYmd = ymd(startOfWeek(new Date(), weekStartsOn));
  const todayYmd = ymd(new Date());
  const days = buildWeekDays(parseYmd(weekStart));
  const isCurrentWeek = weekStart === currentWeekYmd;
  const panelStarts = weekPagerStarts(weekStart);

  const doneColumnIds = new Set(board.columns.filter((c) => c.isDone).map((c) => c.id));
  const tickets = Object.values(ticketsById)
    .filter((t) => !removedIds.has(t.id))
    .map((t) => ({ ...t, done: doneColumnIds.has(t.columnId) }));
  const { byDay, unscheduled } = groupTicketsByWeekDay(tickets, days.map((d) => d.ymd));
  // Done-and-undated cards carry no planning signal — the tray is for triage.
  const openUnscheduled = unscheduled.filter((t) => !t.done);
  const dueThisWeek = days.reduce((n, d) => n + byDay[d.ymd].length, 0);

  // Keep the centered panel centered: instantly (never the html smooth
  // behavior) after every rebase, before paint, so paging feels seamless.
  React.useLayoutEffect(() => {
    const pager = pagerRef.current;
    if (pager) pager.scrollTo({ left: pager.clientWidth, behavior: "instant" });
  }, [weekStart]);

  // Re-center on resize/rotation so the snap pages stay aligned.
  React.useEffect(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    const ro = new ResizeObserver(() => pager.scrollTo({ left: pager.clientWidth, behavior: "instant" }));
    ro.observe(pager);
    return () => ro.disconnect();
  }, []);

  const rebaseWeeks = React.useCallback((weeks: number) => {
    setWeekStart((s) => ymd(addDays(parseYmd(s), 7 * weeks)));
  }, []);

  // Swipe settled on a neighboring panel → adopt that week and re-center.
  function handlePagerScroll() {
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      const pager = pagerRef.current;
      if (!pager || pager.clientWidth === 0) return;
      // Only rebase once the pager actually rests on a snap point — a paused
      // finger mid-drag keeps emitting no events but hasn't settled yet.
      const page = pager.scrollLeft / pager.clientWidth;
      if (Math.abs(page - Math.round(page)) > 0.02) return;
      const delta = pagerSettleDelta(pager.scrollLeft, pager.clientWidth);
      if (delta !== 0) rebaseWeeks(delta);
    }, PAGER_SETTLE_MS);
  }

  React.useEffect(() => {
    return () => {
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  /** Page one week over with the snap easing; larger jumps rebase instantly. */
  const shiftWeek = React.useCallback(
    (weeks: number) => {
      const pager = pagerRef.current;
      if (!pager || Math.abs(weeks) !== 1) {
        rebaseWeeks(weeks);
        return;
      }
      const w = pager.clientWidth;
      // Mid-flight already? Rebase directly instead of stacking animations.
      if (w === 0 || Math.abs(pager.scrollLeft - w) > w * 0.1) {
        rebaseWeeks(weeks);
        return;
      }
      pager.scrollTo({ left: w * (1 + weeks), behavior: prefersReducedMotion() ? "instant" : "smooth" });
    },
    [rebaseWeeks],
  );

  /**
   * Scroll the centered (current-week) panel to today's bucket. `focus` moves
   * keyboard/AT focus there too — used for the explicit "Today" action, not
   * the quiet initial landing (which shouldn't paint a focus ring on load).
   */
  const focusToday = React.useCallback((animate: boolean, focus = true) => {
    const pager = pagerRef.current;
    const target = pager?.querySelector<HTMLElement>(`[data-day="${ymd(new Date())}"]`);
    const scrollPanel = target?.closest<HTMLElement>("[data-week-panel]");
    if (!target || !scrollPanel) return;
    scrollPanel.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: animate && !prefersReducedMotion() ? "smooth" : "instant",
    });
    if (focus) target.focus({ preventScroll: true });
  }, []);

  // Opening Week View lands on today's bucket (req: initial focus).
  React.useEffect(() => {
    focusToday(false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A "Today" jump from another week finishes after the rebase renders.
  React.useEffect(() => {
    if (!pendingTodayFocusRef.current || weekStart !== currentWeekYmd) return;
    pendingTodayFocusRef.current = false;
    focusToday(true);
    setTodayFlash((n) => n + 1);
  }, [weekStart, currentWeekYmd, focusToday]);

  function goToToday() {
    if (isCurrentWeek) {
      focusToday(true);
      setTodayFlash((n) => n + 1);
      return;
    }
    pendingTodayFocusRef.current = true;
    const delta = weeksBetween(weekStart, currentWeekYmd);
    if (Math.abs(delta) === 1) shiftWeek(delta);
    else setWeekStart(currentWeekYmd);
  }

  // Arrow keys page between weeks (skipped while typing or a dialog is open).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      e.preventDefault();
      shiftWeek(e.key === "ArrowLeft" ? -1 : 1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shiftWeek]);

  function handleTicketUpdated(t: SerializedTicket) {
    setTicketsById((m) => ({ ...m, [t.id]: t }));
  }

  function handleTicketDeleted(id: string) {
    setRemovedIds((prev) => new Set(prev).add(id));
    setTicketsById((m) => {
      const mm = { ...m };
      delete mm[id];
      return mm;
    });
    setSelectedId(null);
    // Converge with server truth (and let other views drop the card too).
    router.refresh();
  }

  async function moveTicketToDone(ticketId: string): Promise<SerializedTicket> {
    const doneColumn = board.columns.find((c) => c.isDone);
    if (!doneColumn) throw new Error("No done column is configured for this board.");
    const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${ticketId}/move`, {
      body: { columnId: doneColumn.id, position: Number.MAX_SAFE_INTEGER },
    });
    setTicketsById((m) => ({ ...m, [ticketId]: ticket }));
    return ticket;
  }

  const selectedTicket = selectedId ? ticketsById[selectedId] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-6 lg:px-8">
        {switcher}
        <div className="flex h-9 items-center rounded-lg border border-border bg-surface">
          <button
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            className="grid h-full w-9 place-items-center rounded-s-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToToday}
            title={isCurrentWeek ? "Scroll to today" : "Back to this week"}
            className="h-full px-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            className="grid h-full w-9 place-items-center rounded-e-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="text-sm font-semibold tabular-nums">{weekRangeLabel(days)}</h2>
        {isCurrentWeek && (
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[0.6875rem] font-medium text-primary-soft-fg">
            This week
          </span>
        )}
        <span className="ml-auto text-xs text-fg-subtle tabular-nums" aria-live="polite">
          {dueThisWeek} due
        </span>
      </div>

      {/* Week pager: 3 panels (previous / centered / next), horizontal snap.
          After a settled page the centered week rebases, so swiping is always
          available in both directions. Each panel owns its vertical scroll. */}
      <div
        ref={pagerRef}
        onScroll={handlePagerScroll}
        className="kb-week-pager min-h-0 flex-1 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        {panelStarts.map((start) => {
          const panelDays = buildWeekDays(parseYmd(start));
          const panelGroups = groupTicketsByWeekDay(tickets, panelDays.map((d) => d.ymd));
          const panelDue = panelDays.reduce((n, d) => n + panelGroups.byDay[d.ymd].length, 0);
          return (
            <section
              key={start}
              data-week-panel={start}
              aria-label={`Week of ${weekRangeLabel(panelDays)}`}
              className="relative w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain px-4 pb-6 md:px-6 lg:px-8"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7 animate-fade-in">
                {panelDays.map((d) => {
                  const isToday = d.ymd === todayYmd;
                  const isPast = d.ymd < todayYmd;
                  const dayTickets = panelGroups.byDay[d.ymd];
                  return (
                    <section
                      key={d.ymd}
                      data-day={d.ymd}
                      tabIndex={-1}
                      aria-label={d.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                      className={cn(
                        "relative flex min-h-[7rem] flex-col gap-1.5 rounded-2xl border p-2 outline-none xl:min-h-[14rem]",
                        isToday ? "kb-today" : "border-border bg-surface-2/60",
                        isPast && !isToday && "opacity-75",
                      )}
                    >
                      {isToday && todayFlash > 0 && (
                        // Remounts per press so the attention pulse can replay.
                        <span key={todayFlash} aria-hidden className="kb-today-flash pointer-events-none absolute inset-0 rounded-2xl" />
                      )}
                      <header className="flex items-baseline gap-1.5 px-1 pt-0.5">
                        <span
                          className={cn(
                            "text-[0.6875rem] font-semibold uppercase tracking-wider",
                            isToday ? "text-primary" : "text-fg-subtle",
                          )}
                        >
                          {d.date.toLocaleDateString(undefined, { weekday: "short" })}
                        </span>
                        <span className={cn("text-sm font-semibold tabular-nums", isToday && "text-primary")}>
                          {d.date.getDate()}
                        </span>
                        {isToday && <span className="sr-only">(today)</span>}
                        {dayTickets.length > 0 && (
                          <span className="ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-[0.625rem] font-medium tabular-nums text-fg-muted">
                            {dayTickets.length}
                          </span>
                        )}
                      </header>
                      {dayTickets.map((t) => (
                        <WeekCard key={t.id} ticket={t} onClick={() => setSelectedId(t.id)} />
                      ))}
                    </section>
                  );
                })}

                <section
                  aria-label="No due date"
                  className="rounded-2xl border border-dashed border-border bg-surface-2/30 p-2 xl:col-span-7"
                >
                  <header className="flex items-center gap-1.5 px-1 pt-0.5 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">
                    <CalendarX2 className="h-3.5 w-3.5" />
                    No date
                    <span className="ml-auto tabular-nums">{openUnscheduled.length}</span>
                  </header>
                  {openUnscheduled.length === 0 ? (
                    <p className="px-1 pb-1 text-xs text-fg-subtle">Every open card has a due date.</p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5 xl:grid xl:grid-cols-4 xl:gap-2 2xl:grid-cols-5">
                        {(showAllUnscheduled ? openUnscheduled : openUnscheduled.slice(0, UNSCHEDULED_VISIBLE_LIMIT)).map(
                          (t) => (
                            <WeekCard key={t.id} ticket={t} onClick={() => setSelectedId(t.id)} />
                          ),
                        )}
                      </div>
                      {openUnscheduled.length > UNSCHEDULED_VISIBLE_LIMIT && (
                        <button
                          onClick={() => setShowAllUnscheduled((v) => !v)}
                          className="mt-1.5 rounded-lg px-2 py-1.5 text-start text-xs font-medium text-fg-muted hover:bg-surface-3 hover:text-fg cursor-pointer"
                        >
                          {showAllUnscheduled
                            ? "Show fewer"
                            : `Show ${openUnscheduled.length - UNSCHEDULED_VISIBLE_LIMIT} more`}
                        </button>
                      )}
                    </>
                  )}
                </section>
              </div>

              {panelDue === 0 && (
                <p className="mt-4 flex items-center justify-center gap-2 text-sm text-fg-subtle">
                  <CalendarDays className="h-4 w-4" />
                  Nothing due this week — cards with a due date land on their day.
                </p>
              )}
            </section>
          );
        })}
      </div>

      {selectedTicket && (
        <TicketModal
          ticket={selectedTicket}
          columns={board.columns}
          labels={board.labels}
          // Same rule as the kanban pickers: only the user's own + workspace
          // agents are assignable; the server enforces this too.
          agents={agents.filter((a) => canAssignAgent(a, currentUser?.id))}
          members={members}
          currentUser={currentUser}
          onClose={() => setSelectedId(null)}
          onUpdated={handleTicketUpdated}
          onDeleted={handleTicketDeleted}
          onMoveToDone={() => moveTicketToDone(selectedTicket.id)}
        />
      )}
    </div>
  );
}

/** Faces shown in a week card's assignee stack before folding into "+N". */
const WEEK_CARD_AVATAR_LIMIT = 3;

/** A compact journal entry: title, then number / priority / done tick / assignees. */
function WeekCard({
  ticket,
  onClick,
}: {
  ticket: SerializedTicket & { done: boolean };
  onClick: () => void;
}) {
  const pr = priorityMeta(ticket.priority);
  const assignees = cardAssignees(ticket);
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border bg-surface p-2 text-start shadow-card transition-all",
        "hover:border-border-strong hover:shadow-md hover:-translate-y-px active:translate-y-0 cursor-pointer",
        ticket.done && "opacity-70",
      )}
    >
      {/* dir="auto": first strong character sets base direction, so Hebrew/Arabic
          titles read right-to-left even when they mix in English words. */}
      <p
        dir="auto"
        className={cn("line-clamp-3 text-xs font-medium leading-snug text-fg", ticket.done && "text-fg-muted line-through")}
      >
        {ticket.title}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {ticket.number != null && (
          <span className="text-[0.625rem] font-medium text-fg-subtle">#{ticket.number}</span>
        )}
        {ticket.priority !== "none" && (
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pr.color }} title={pr.label} />
        )}
        {ticket.done && <CircleCheck className="h-3.5 w-3.5 text-success" aria-label="Done" />}
        {assignees.length > 0 && (
          <span
            role="group"
            aria-label={`Assigned to ${assignees.map((a) => assigneeLabel(a)).join(", ")}`}
            className="ms-auto flex shrink-0 items-center -space-x-1"
          >
            {assignees.slice(0, WEEK_CARD_AVATAR_LIMIT).map((a) => (
              <span key={`${a.type}-${a.id}`} className="rounded-full ring-2 ring-surface">
                <Avatar
                  name={a.name}
                  color={a.color}
                  src={a.type === "user" ? a.avatarUrl : undefined}
                  isAgent={a.type === "agent"}
                  size={18}
                  title={assigneeLabel(a)}
                />
              </span>
            ))}
            {assignees.length > WEEK_CARD_AVATAR_LIMIT && (
              <span
                className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-surface-2 px-0.5 text-[0.5625rem] font-semibold tabular-nums text-fg-muted ring-2 ring-surface"
                title={assignees.slice(WEEK_CARD_AVATAR_LIMIT).map((a) => assigneeLabel(a)).join(", ")}
              >
                +{assignees.length - WEEK_CARD_AVATAR_LIMIT}
              </span>
            )}
          </span>
        )}
      </div>
    </button>
  );
}
