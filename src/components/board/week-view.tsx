"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import { TicketModal } from "./ticket-modal";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { priorityMeta, assigneeLabel, canAssignAgent } from "@/lib/display";
import { addDays, parseYmd, ymd } from "@/lib/notes-schedule";
import {
  buildWeekDays,
  groupTicketsByWeekDay,
  startOfWeek,
  weekRangeLabel,
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
type MemberLite = { id: string; name: string; avatarUrl?: string | null };

/** Undated tickets shown before the tray offers to reveal the rest. */
const UNSCHEDULED_VISIBLE_LIMIT = 10;

function buildTicketsById(board: BoardData): Record<string, SerializedTicket> {
  const m: Record<string, SerializedTicket> = {};
  board.columns.forEach((c) => c.tickets.forEach((t) => (m[t.id] = t)));
  return m;
}

/**
 * Per-board Week View: the board's tickets laid out as a weekly journal —
 * one bucket per local calendar day (by due date), plus a "No date" tray —
 * with previous/current/next week navigation. Read-and-open: tap a card for
 * the full ticket modal; scheduling stays on the due-date field there.
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

  // Server truth changed (focus revalidation, an agent filing tickets) →
  // rebuild, adjusting state during render (no effect round-trip).
  const [prevBoard, setPrevBoard] = React.useState(board);
  if (prevBoard !== board) {
    setPrevBoard(board);
    setTicketsById(buildTicketsById(board));
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

  const doneColumnIds = new Set(board.columns.filter((c) => c.isDone).map((c) => c.id));
  const tickets = Object.values(ticketsById).map((t) => ({ ...t, done: doneColumnIds.has(t.columnId) }));
  const { byDay, unscheduled } = groupTicketsByWeekDay(tickets, days.map((d) => d.ymd));
  // Done-and-undated cards carry no planning signal — the tray is for triage.
  const openUnscheduled = unscheduled.filter((t) => !t.done);
  const dueThisWeek = days.reduce((n, d) => n + byDay[d.ymd].length, 0);

  function shiftWeek(weeks: number) {
    setWeekStart((s) => ymd(addDays(parseYmd(s), 7 * weeks)));
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
  }, []);

  function handleTicketUpdated(t: SerializedTicket) {
    setTicketsById((m) => ({ ...m, [t.id]: t }));
  }

  function handleTicketDeleted(id: string) {
    setTicketsById((m) => {
      const mm = { ...m };
      delete mm[id];
      return mm;
    });
    setSelectedId(null);
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
            onClick={() => setWeekStart(currentWeekYmd)}
            disabled={isCurrentWeek}
            className={cn(
              "h-full px-2.5 text-sm font-medium transition-colors",
              isCurrentWeek ? "text-fg-subtle" : "text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer",
            )}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
          {days.map((d) => {
            const isToday = d.ymd === todayYmd;
            const isPast = d.ymd < todayYmd;
            const dayTickets = byDay[d.ymd];
            return (
              <section
                key={d.ymd}
                aria-label={d.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                className={cn(
                  "flex min-h-[7rem] flex-col gap-1.5 rounded-2xl border p-2 xl:min-h-[14rem]",
                  isToday ? "border-primary/40 bg-primary-soft/30" : "border-border bg-surface-2/50",
                  isPast && !isToday && "opacity-75",
                )}
              >
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
                    <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-medium tabular-nums text-fg-subtle">
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

        {dueThisWeek === 0 && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-fg-subtle">
            <CalendarDays className="h-4 w-4" />
            Nothing due this week — cards with a due date land on their day.
          </p>
        )}
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

/** A compact journal entry: title, then number / priority / done tick / assignee. */
function WeekCard({
  ticket,
  onClick,
}: {
  ticket: SerializedTicket & { done: boolean };
  onClick: () => void;
}) {
  const pr = priorityMeta(ticket.priority);
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
        {ticket.assignee && (
          <span className="ms-auto">
            <Avatar
              name={ticket.assignee.name}
              color={ticket.assignee.type === "agent" ? ticket.assignee.color : undefined}
              isAgent={ticket.assignee.type === "agent"}
              size={18}
              title={assigneeLabel(ticket.assignee)}
            />
          </span>
        )}
      </div>
    </button>
  );
}
