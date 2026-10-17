"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CalendarPlus, Check, ChevronLeft, ChevronRight, Inbox, X } from "lucide-react";
import { tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import * as sync from "@/lib/offline/sync-store";
import { dueFromDay, parseYmd, startOfDay, ymd } from "@/lib/notes-schedule";
import { textDirection } from "@/lib/text-direction";
import { dayLabel, LOCALE, type TaskItem, type TodayNote, type TodayTicket } from "@/lib/today-model";
import { STAGE_META } from "@/lib/column-stage";
import {
  buildPlan,
  eventsByDay,
  eventTime,
  monthWeeks,
  shiftAnchor,
  ticketStage,
  weekDays,
  type PlanColumn,
  type PlanEvent,
} from "@/lib/plan-model";
import { cn } from "@/lib/utils";
import type { TodayBoard } from "@/components/today/today-view";

export type PlanBoard = TodayBoard;
type Feed = { id: string; name: string; color: string };
type View = "month" | "week";
type Override = { day?: string | null; done?: boolean };

/** Cell rows shown in a month cell before "+n more". */
const MONTH_CELL_LIMIT = 3;

/**
 * Plan: every task and ticket on a calendar, a tray of what still needs a
 * day, and your external calendars for context. Drag anything onto a day (or
 * back to the tray to clear its date); without a mouse, pick an item and tap
 * a day. Writes go through the offline outbox, like Today.
 */
export function PlanView({
  tasks: serverTasks,
  tickets: serverTickets,
  boards,
  feeds,
  weekStartsOn,
  initialNow,
}: {
  tasks: TodayNote[];
  tickets: TodayTicket[];
  boards: PlanBoard[];
  feeds: Feed[];
  weekStartsOn: number;
  initialNow: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const now = React.useMemo(() => new Date(initialNow), [initialNow]);
  const todayYmd = ymd(startOfDay(now));

  const [view, setView] = React.useState<View>("month");
  const [anchor, setAnchor] = React.useState(() => startOfDay(now));
  const [selectedDay, setSelectedDay] = React.useState(todayYmd);
  const [picked, setPicked] = React.useState<TaskItem | null>(null);
  const [dragging, setDragging] = React.useState<TaskItem | null>(null);
  const [trayTab, setTrayTab] = React.useState<"tasks" | "tickets">("tasks");
  const [boardFilter, setBoardFilter] = React.useState<string | null>(null);

  // ── data: server rows + optimistic edits until the server agrees ─────────
  const [overrides, setOverrides] = React.useState<Record<string, Override>>({});
  const [seen, setSeen] = React.useState({ serverTasks, serverTickets });
  if (seen.serverTasks !== serverTasks || seen.serverTickets !== serverTickets) {
    setSeen({ serverTasks, serverTickets });
    // Keep only edits the fresh server rows don't reflect yet.
    const next: Record<string, Override> = {};
    for (const [id, o] of Object.entries(overrides)) {
      const n = serverTasks.find((x) => x.id === id);
      const t = serverTickets.find((x) => x.id === id);
      const day = n ? n.scheduledDay : t ? (t.dueDate ? ymd(new Date(t.dueDate)) : null) : undefined;
      const done = n ? n.doneOn != null : undefined;
      if ((o.day !== undefined && o.day !== day) || (o.done !== undefined && o.done !== done)) next[id] = o;
    }
    setOverrides(next);
  }
  const tasks = React.useMemo(
    () =>
      serverTasks.map((n) => {
        const o = overrides[n.id];
        if (!o) return n;
        return {
          ...n,
          ...(o.day !== undefined ? { scheduledDay: o.day } : {}),
          ...(o.done !== undefined ? { doneOn: o.done ? n.doneOn ?? todayYmd : null } : {}),
        };
      }),
    [serverTasks, overrides, todayYmd],
  );
  const tickets = React.useMemo(
    () =>
      serverTickets.map((t) => {
        const o = overrides[t.id];
        return o?.day !== undefined ? { ...t, dueDate: dueFromDay(o.day) } : t;
      }),
    [serverTickets, overrides],
  );
  const columns = React.useMemo(() => {
    const m = new Map<string, PlanColumn>();
    for (const b of boards) for (const c of b.columns) m.set(c.id, c);
    return m;
  }, [boards]);
  const plan = React.useMemo(() => buildPlan({ tasks, tickets, columns, now }), [tasks, tickets, columns, now]);

  // Server state follows the outbox: refresh once edits land, and on focus.
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => sync.getSnapshot().status.online && router.refresh(), 400);
    };
    const off = sync.onSyncEvent((e) => {
      if (e.type === "rejected") {
        toast({ title: "Couldn't save a date", description: e.message, variant: "error" });
        if ("id" in e.op) {
          const id = e.op.id;
          setOverrides((o) => {
            const next = { ...o };
            delete next[id];
            return next;
          });
        }
      }
      refreshSoon();
    });
    const onFocus = () => refreshSoon();
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
      if (t) clearTimeout(t);
    };
  }, [router, toast]);

  // ── writes ─────────────────────────────────────────────────────────────────
  function setDay(item: TaskItem, day: string | null) {
    if (item.day === day) return;
    setOverrides((o) => ({ ...o, [item.id]: { ...o[item.id], day } }));
    if (item.kind === "note") {
      sync.enqueue({ kind: "note.patch", id: item.id, body: { scheduledDay: day }, optimistic: { scheduledDay: day } });
    } else {
      const dueDate = dueFromDay(day);
      sync.enqueue({ kind: "ticket.patch", id: item.id, body: { dueDate }, optimistic: { dueDate } });
    }
    const title = item.title.split("\n")[0].slice(0, 80);
    toast({
      title: day ? `Planned for ${dayLabel(day, todayYmd).label}` : "Date cleared",
      description: title,
      variant: "success",
      actionLabel: "Undo",
      duration: 5000,
      onAction: () => setDay({ ...item, day } as TaskItem, item.kind === "note" ? item.note.scheduledDay : item.day),
    });
  }

  function toggleDone(item: TaskItem) {
    if (item.kind !== "note") return;
    const done = !item.done;
    setOverrides((o) => ({ ...o, [item.id]: { ...o[item.id], done } }));
    const doneOn = done ? todayYmd : null;
    sync.enqueue({ kind: "note.patch", id: item.id, body: { doneOn }, optimistic: { doneOn } });
  }

  function openTicket(id: string) {
    router.push(`/plan?ticket=${id}`, { scroll: false });
  }

  // Tap-to-place: an item is picked, the next day tapped receives it.
  function dayTapped(day: string) {
    if (picked) {
      setDay(picked, day);
      setPicked(null);
      return;
    }
    setSelectedDay(day);
  }
  React.useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picked]);

  // ── drag & drop ────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch: a long-press lifts the item, so plain swipes still scroll.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const onDragStart = (e: DragStartEvent) => {
    setPicked(null);
    setDragging((e.active.data.current as { item: TaskItem } | undefined)?.item ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const item = (e.active.data.current as { item: TaskItem } | undefined)?.item;
    setDragging(null);
    const over = e.over?.id;
    if (!item || typeof over !== "string") return;
    if (over === "tray") setDay(item, null);
    else if (over.startsWith("day:")) setDay(item, over.slice(4));
  };

  // ── calendar geometry + events ─────────────────────────────────────────────
  const weeks = React.useMemo(() => monthWeeks(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const week = React.useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const visible = view === "month" ? weeks.flat() : week;
  const from = ymd(visible[0]);
  const to = ymd(visible[visible.length - 1]);
  const { events, errors } = useCalendarEvents(feeds.length > 0, from, to);
  const evByDay = React.useMemo(() => eventsByDay(events), [events]);
  const feedColor = React.useMemo(() => new Map(feeds.map((f) => [f.id, f.color])), [feeds]);

  const rangeLabel =
    view === "month"
      ? anchor.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })
      : `${week[0].toLocaleDateString(LOCALE, { month: "short", day: "numeric" })} – ${week[6].toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric" })}`;
  const isCurrent = view === "month" ? anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear() : visible.some((d) => ymd(d) === todayYmd);

  const dayProps = (day: string) => ({
    day,
    todayYmd,
    items: plan.itemsByDay.get(day) ?? [],
    events: evByDay.get(day) ?? [],
    feedColor,
    picking: !!picked,
    onTap: () => dayTapped(day),
    onToggle: toggleDone,
    onOpenTicket: openTicket,
    onPick: setPicked,
  });

  const trayCounts = {
    tasks: plan.tray.tasks.overdue.length + plan.tray.tasks.undated.length,
    tickets: plan.tray.tickets.overdue.length + plan.tray.tickets.undated.length,
  };

  return (
    // A fixed id keeps dnd-kit's aria-describedby ids identical on server and client.
    <DndContext id="plan-dnd" sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="mx-auto w-full max-w-[96rem] px-4 pt-4 pb-28 md:px-8 md:pt-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Plan</h1>
            <p className="mt-0.5 text-sm text-fg-muted">Give every task a day — drag it onto the calendar.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Calendar view" className="flex rounded-xl bg-surface-2 p-0.5 text-sm">
              {(["month", "week"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setView(v);
                    if (v === "week") setAnchor(view === "month" && !isCurrent ? anchor : parseYmd(selectedDay));
                  }}
                  className={cn("rounded-lg px-3 py-1 capitalize transition-colors cursor-pointer", view === v ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg")}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-xl border border-border bg-surface">
              <button onClick={() => setAnchor(shiftAnchor(anchor, view, -1))} className="grid h-8 w-8 place-items-center rounded-l-xl text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer" aria-label={`Previous ${view}`}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setAnchor(startOfDay(now));
                  setSelectedDay(todayYmd);
                }}
                disabled={isCurrent}
                className="h-8 border-x border-border px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                Today
              </button>
              <button onClick={() => setAnchor(shiftAnchor(anchor, view, 1))} className="grid h-8 w-8 place-items-center rounded-r-xl text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer" aria-label={`Next ${view}`}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          <span className="font-display text-lg font-medium text-fg">{rangeLabel}</span>
          {feeds.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(f.color).dot }} />
              <span dir="auto">{f.name}</span>
            </span>
          ))}
          {feeds.length === 0 && (
            <Link href="/settings#calendars" className="inline-flex items-center gap-1 hover:text-fg">
              <CalendarPlus className="h-3.5 w-3.5" /> Show your Google Calendar here
            </Link>
          )}
          {errors.map((e) => (
            <span key={e.feedId} className="inline-flex items-center gap-1 text-danger" title={e.message}>
              <AlertTriangle className="h-3.5 w-3.5" /> {e.name}: {e.message}
            </span>
          ))}
        </div>

        <div className="mt-3 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          {/* Calendar */}
          <div className="min-w-0">
            {view === "month" ? (
              <>
                <WeekdayHeader days={weeks[0]} />
                <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                  {weeks.map((w, i) => (
                    <div key={i} className={cn("grid grid-cols-7", i > 0 && "border-t border-border")}>
                      {w.map((d, j) => (
                        <MonthCell
                          key={ymd(d)}
                          {...dayProps(ymd(d))}
                          outside={d.getMonth() !== anchor.getMonth()}
                          selected={ymd(d) === selectedDay}
                          edge={j === 0}
                          onMore={() => {
                            setAnchor(d);
                            setView("week");
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {/* Phones: the chosen day's list under the compact month */}
                <div className="mt-4 md:hidden">
                  <AgendaDay {...dayProps(selectedDay)} />
                </div>
              </>
            ) : (
              <>
                <div className="hidden md:block">
                  <WeekdayHeader days={week} withDates todayYmd={todayYmd} />
                  <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-border bg-surface">
                    {week.map((d, j) => (
                      <WeekColumn key={ymd(d)} {...dayProps(ymd(d))} edge={j === 0} />
                    ))}
                  </div>
                </div>
                <div className="space-y-3 md:hidden">
                  {week.map((d) => (
                    <AgendaDay key={ymd(d)} {...dayProps(ymd(d))} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Tray */}
          <Tray
            tab={trayTab}
            onTab={setTrayTab}
            counts={trayCounts}
            plan={plan}
            boards={boards}
            columns={columns}
            boardFilter={boardFilter}
            onBoardFilter={setBoardFilter}
            picked={picked}
            onPick={(item) => {
              setPicked(picked?.id === item.id ? null : item);
              if (window.matchMedia("(max-width: 1023px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onOpenTicket={openTicket}
            dragging={dragging}
          />
        </div>
      </div>

      {/* Tap-to-place bar */}
      {picked && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
          <div className="flex max-w-md items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-2.5 shadow-lg animate-slide-up-fade">
            <CalendarPlus className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 text-sm">
              Tap a day for <span className="font-medium" dir="auto">“{picked.title.split("\n")[0].slice(0, 40)}”</span>
            </span>
            <button onClick={() => setPicked(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer" aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Portaled: the page sits in a transformed container, which would offset a fixed overlay. */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay dropAnimation={null}>
            {dragging ? (
              <div className="w-56">
                <ItemChip item={dragging} roomy overlay />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

// ── events ────────────────────────────────────────────────────────────────────

function useCalendarEvents(enabled: boolean, from: string, to: string) {
  const [state, setState] = React.useState<{ key: string; events: PlanEvent[]; errors: { feedId: string; name: string; message: string }[] }>({ key: "", events: [], errors: [] });
  React.useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    fetch(`/api/calendar/events?from=${from}&to=${to}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState({ key: `${from}:${to}`, events: d.events ?? [], errors: d.errors ?? [] }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [enabled, from, to]);
  // The last range's events stay on screen while the next one loads.
  return state;
}

// ── calendar pieces ───────────────────────────────────────────────────────────

type DayProps = {
  day: string;
  todayYmd: string;
  items: TaskItem[];
  events: PlanEvent[];
  feedColor: Map<string, string>;
  picking: boolean;
  onTap: () => void;
  onToggle: (item: TaskItem) => void;
  onOpenTicket: (id: string) => void;
  onPick: (item: TaskItem) => void;
};

function WeekdayHeader({ days, withDates, todayYmd }: { days: Date[]; withDates?: boolean; todayYmd?: string }) {
  return (
    <div className="mb-1.5 grid grid-cols-7 px-1 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
      {days.map((d) => (
        <div key={ymd(d)} className={cn("px-1.5", withDates && ymd(d) === todayYmd && "text-primary")}>
          {d.toLocaleDateString(LOCALE, { weekday: "short" })}
          {withDates && <span className="ml-1 font-display text-sm normal-case tracking-normal">{d.getDate()}</span>}
        </div>
      ))}
    </div>
  );
}

function useDayDrop(day: string) {
  return useDroppable({ id: `day:${day}` });
}

function DayNumber({ day, todayYmd, muted }: { day: string; todayYmd: string; muted?: boolean }) {
  const isToday = day === todayYmd;
  return (
    <span
      className={cn(
        "grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums",
        isToday ? "bg-primary font-semibold text-primary-fg" : muted ? "text-fg-subtle/60" : "text-fg-muted",
      )}
    >
      {parseYmd(day).getDate()}
    </span>
  );
}

function MonthCell({
  outside,
  selected,
  edge,
  onMore,
  ...p
}: DayProps & { outside: boolean; selected: boolean; edge: boolean; onMore: () => void }) {
  const { setNodeRef, isOver } = useDayDrop(p.day);
  const past = p.day < p.todayYmd;
  const entries = [...p.events.map((e) => ({ kind: "event" as const, e })), ...p.items.map((item) => ({ kind: "item" as const, item }))];
  const shown = entries.slice(0, MONTH_CELL_LIMIT);
  const more = entries.length - shown.length;
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, [data-chip]")) return;
        p.onTap();
      }}
      className={cn(
        "group/cell relative min-w-0 cursor-pointer p-1 transition-colors md:min-h-[7.5rem] md:p-1.5",
        !edge && "border-l border-border",
        outside && "bg-surface-2/40",
        isOver && "bg-primary-soft/60 ring-2 ring-inset ring-primary",
        p.picking && !isOver && "hover:bg-primary-soft/40",
        selected && "max-md:bg-surface-2",
      )}
    >
      <div className="flex items-center justify-between">
        <DayNumber day={p.day} todayYmd={p.todayYmd} muted={outside} />
      </div>
      {/* Phones: dots only */}
      <div className="mt-1 flex h-2 justify-center gap-0.5 md:hidden">
        {entries.slice(0, 4).map((x, i) => (
          <span
            key={i}
            className={cn("h-1.5 w-1.5 rounded-full", x.kind === "item" && x.item.done && "opacity-40")}
            style={{ backgroundColor: x.kind === "event" ? tone(p.feedColor.get(x.e.feedId) ?? "blue").dot : x.item.kind === "ticket" ? tone(x.item.ticket.board.color).dot : "var(--color-fg)" }}
          />
        ))}
      </div>
      <div className={cn("mt-1 hidden space-y-0.5 md:block", past && "opacity-80")}>
        {shown.map((x) =>
          x.kind === "event" ? (
            <EventChip key={x.e.id} event={x.e} color={p.feedColor.get(x.e.feedId) ?? "blue"} />
          ) : (
            <DraggableChip key={x.item.id} item={x.item} onToggle={p.onToggle} onOpenTicket={p.onOpenTicket} onPick={p.onPick} />
          ),
        )}
        {more > 0 && (
          <button onClick={onMore} className="w-full rounded-md px-1.5 py-0.5 text-left text-[0.6875rem] text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer">
            +{more} more
          </button>
        )}
      </div>
    </div>
  );
}

function WeekColumn({ edge, ...p }: DayProps & { edge: boolean }) {
  const { setNodeRef, isOver } = useDayDrop(p.day);
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, [data-chip]")) return;
        p.onTap();
      }}
      className={cn(
        "min-h-[30rem] min-w-0 cursor-pointer space-y-1 p-1.5 transition-colors",
        !edge && "border-l border-border",
        p.day === p.todayYmd && "bg-primary-soft/20",
        isOver && "bg-primary-soft/60 ring-2 ring-inset ring-primary",
        p.picking && !isOver && "hover:bg-primary-soft/40",
      )}
    >
      {p.events.map((e) => (
        <EventChip key={e.id} event={e} color={p.feedColor.get(e.feedId) ?? "blue"} roomy />
      ))}
      {p.items.map((item) => (
        <DraggableChip key={item.id} item={item} roomy onToggle={p.onToggle} onOpenTicket={p.onOpenTicket} onPick={p.onPick} />
      ))}
    </div>
  );
}

/** A day as a list — phones (week view, and the chosen day under the month). */
function AgendaDay(p: DayProps) {
  const { setNodeRef, isOver } = useDayDrop(p.day);
  const { label, sublabel } = dayLabel(p.day, p.todayYmd);
  const empty = p.items.length === 0 && p.events.length === 0;
  return (
    <section
      ref={setNodeRef}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, [data-chip]")) return;
        p.onTap();
      }}
      className={cn(
        "rounded-2xl border border-border bg-surface p-3 transition-colors",
        p.day === p.todayYmd && "border-primary/40",
        (isOver || p.picking) && "ring-2 ring-primary/50",
      )}
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className={cn("font-display text-[1.05rem] font-medium", p.day === p.todayYmd && "text-primary")}>{label}</span>
        <span className="text-xs text-fg-subtle">{sublabel}</span>
      </div>
      <div className="space-y-1">
        {p.events.map((e) => (
          <EventChip key={e.id} event={e} color={p.feedColor.get(e.feedId) ?? "blue"} roomy />
        ))}
        {p.items.map((item) => (
          <DraggableChip key={item.id} item={item} roomy onToggle={p.onToggle} onOpenTicket={p.onOpenTicket} onPick={p.onPick} />
        ))}
        {empty && <p className="py-1 text-xs text-fg-subtle">{p.picking ? "Tap to plan it here." : "Nothing planned."}</p>}
      </div>
    </section>
  );
}

// ── chips ─────────────────────────────────────────────────────────────────────

function EventChip({ event, color, roomy }: { event: PlanEvent; color: string; roomy?: boolean }) {
  const t = tone(color);
  const time = eventTime(event);
  return (
    <div
      data-chip
      title={[time, event.title, event.location].filter(Boolean).join(" · ")}
      dir={textDirection(event.title)}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 text-start",
        roomy ? "py-1 text-[0.8125rem]" : "py-0.5 text-[0.6875rem]",
        event.allDay ? "font-medium" : "text-fg-muted",
      )}
      style={event.allDay ? { backgroundColor: t.bg, color: t.fg } : { boxShadow: `inset 2px 0 0 ${t.dot}` }}
    >
      {time && <span className="shrink-0 tabular-nums text-fg-subtle" dir="ltr">{time}</span>}
      <span className={cn("min-w-0", roomy ? "line-clamp-2" : "truncate")}>{event.title}</span>
    </div>
  );
}

function DraggableChip(props: { item: TaskItem; roomy?: boolean; onToggle: (i: TaskItem) => void; onOpenTicket: (id: string) => void; onPick: (i: TaskItem) => void }) {
  const { item } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${item.kind}:${item.id}`, data: { item }, disabled: item.done });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-30")}>
      <ItemChip {...props} />
    </div>
  );
}

function ItemChip({
  item,
  roomy,
  overlay,
  onToggle,
  onOpenTicket,
  onPick,
}: {
  item: TaskItem;
  roomy?: boolean;
  overlay?: boolean;
  onToggle?: (i: TaskItem) => void;
  onOpenTicket?: (id: string) => void;
  onPick?: (i: TaskItem) => void;
}) {
  const title = item.title.split("\n")[0];
  const ticket = item.kind === "ticket" ? item.ticket : null;
  return (
    <div
      data-chip
      dir={textDirection(title)}
      className={cn(
        "group/chip flex min-w-0 items-start gap-1.5 rounded-md text-start transition-colors",
        roomy ? "px-2 py-1.5 text-[0.8125rem] leading-5" : "px-1.5 py-0.5 text-[0.6875rem] leading-4",
        overlay ? "cursor-grabbing border border-border bg-surface shadow-lg" : "cursor-grab bg-surface-2/70 hover:bg-surface-3",
        item.done && "opacity-60",
      )}
    >
      {ticket ? (
        <span className={cn("shrink-0 rounded-full", roomy ? "mt-1.5 h-2 w-2" : "mt-1 h-1.5 w-1.5")} style={{ backgroundColor: tone(ticket.board.color).dot }} />
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToggle?.(item)}
          aria-label={item.done ? "Mark not done" : "Mark done"}
          data-checked={item.done}
          className={cn("kb-check shrink-0 cursor-pointer", roomy ? "mt-0.5 !h-4 !w-4" : "mt-px !h-3 !w-3 !border")}
        >
          <Check className={roomy ? "h-2.5 w-2.5" : "h-2 w-2"} strokeWidth={3} />
        </button>
      )}
      <button
        type="button"
        onClick={() => (ticket ? onOpenTicket?.(ticket.id) : onPick?.(item))}
        className={cn("min-w-0 flex-1 text-start cursor-pointer", roomy ? "line-clamp-2" : "truncate", item.done && "line-through")}
        title={title}
      >
        {ticket?.number != null && <span className="text-fg-subtle">#{ticket.number} </span>}
        {title}
      </button>
    </div>
  );
}

// ── tray ──────────────────────────────────────────────────────────────────────

function Tray({
  tab,
  onTab,
  counts,
  plan,
  boards,
  columns,
  boardFilter,
  onBoardFilter,
  picked,
  onPick,
  onOpenTicket,
  dragging,
}: {
  tab: "tasks" | "tickets";
  onTab: (t: "tasks" | "tickets") => void;
  counts: { tasks: number; tickets: number };
  plan: ReturnType<typeof buildPlan>;
  boards: PlanBoard[];
  columns: Map<string, PlanColumn>;
  boardFilter: string | null;
  onBoardFilter: (id: string | null) => void;
  picked: TaskItem | null;
  onPick: (item: TaskItem) => void;
  onOpenTicket: (id: string) => void;
  dragging: TaskItem | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  const groups = tab === "tasks" ? plan.tray.tasks : plan.tray.tickets;
  const byBoard = (list: TaskItem[]) => (boardFilter ? list.filter((i) => i.kind === "ticket" && i.ticket.board.id === boardFilter) : list);
  const overdue = tab === "tickets" ? byBoard(groups.overdue) : groups.overdue;
  const undated = tab === "tickets" ? byBoard(groups.undated) : groups.undated;
  const boardsWithWork = boards.filter((b) => [...plan.tray.tickets.overdue, ...plan.tray.tickets.undated].some((i) => i.kind === "ticket" && i.ticket.board.id === b.id));
  const canUnschedule = !!dragging && dragging.day != null;

  return (
    <aside
      ref={setNodeRef}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-border bg-surface transition-colors lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]",
        isOver && canUnschedule && "border-primary ring-2 ring-primary/30",
      )}
    >
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-[1.1rem] font-medium">To plan</span>
          {canUnschedule && <span className="text-[0.6875rem] text-primary">Drop here to clear the date</span>}
        </div>
        <div role="tablist" className="mt-2.5 flex rounded-xl bg-surface-2 p-0.5 text-[0.8125rem]">
          {(["tasks", "tickets"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1 capitalize transition-colors cursor-pointer", tab === t ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg")}
            >
              {t}
              <span className="text-[0.6875rem] tabular-nums text-fg-subtle">{counts[t]}</span>
            </button>
          ))}
        </div>
        {tab === "tickets" && boardsWithWork.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <FilterChip active={!boardFilter} onClick={() => onBoardFilter(null)}>All</FilterChip>
            {boardsWithWork.map((b) => (
              <FilterChip key={b.id} active={boardFilter === b.id} onClick={() => onBoardFilter(boardFilter === b.id ? null : b.id)}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                <span dir="auto">{b.name}</span>
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {overdue.length > 0 && (
          <TrayGroup label="Overdue" danger>
            {overdue.map((i) => (
              <TrayItem key={i.id} item={i} todayYmd={plan.todayYmd} columns={columns} picked={picked?.id === i.id} onPick={onPick} onOpenTicket={onOpenTicket} />
            ))}
          </TrayGroup>
        )}
        <TrayGroup label={tab === "tasks" ? "No day yet" : "No due date"}>
          {undated.map((i) => (
            <TrayItem key={i.id} item={i} todayYmd={plan.todayYmd} columns={columns} picked={picked?.id === i.id} onPick={onPick} onOpenTicket={onOpenTicket} />
          ))}
          {undated.length === 0 && (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-fg-subtle">
              <Inbox className="h-4 w-4" />
              {tab === "tasks" ? "Every task has a day." : "Every ticket has a due date."}
            </p>
          )}
        </TrayGroup>
      </div>
    </aside>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[0.6875rem] transition-colors cursor-pointer",
        active ? "border-fg bg-fg text-bg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function TrayGroup({ label, danger, children }: { label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className={cn("px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-wider", danger ? "text-danger" : "text-fg-subtle")}>{label}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function TrayItem({
  item,
  todayYmd,
  columns,
  picked,
  onPick,
  onOpenTicket,
}: {
  item: TaskItem;
  todayYmd: string;
  columns: Map<string, PlanColumn>;
  picked: boolean;
  onPick: (i: TaskItem) => void;
  onOpenTicket: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tray:${item.kind}:${item.id}`, data: { item } });
  const title = item.title.split("\n")[0];
  const ticket = item.kind === "ticket" ? item.ticket : null;
  const stage = ticket ? ticketStage(ticket, columns) : null;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "group/tray flex cursor-grab touch-manipulation items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors",
        picked ? "border-primary bg-primary-soft/50" : "border-transparent bg-surface-2/60 hover:border-border",
        isDragging && "opacity-30",
      )}
    >
      <div className="min-w-0 flex-1" dir={textDirection(title)}>
        <button
          type="button"
          onClick={() => (ticket ? onOpenTicket(ticket.id) : onPick(item))}
          className="line-clamp-2 block w-full text-start text-[0.8125rem] leading-5 text-fg cursor-pointer"
          title={title}
        >
          {title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-fg-subtle">
          {ticket && (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(ticket.board.color).dot }} />
              <span dir="auto">{ticket.board.name}</span>
              {ticket.number != null && <span>#{ticket.number}</span>}
            </span>
          )}
          {stage && stage !== "done" && <span>{STAGE_META[stage].label}</span>}
          {item.day && item.day < todayYmd && <span className="text-danger">{dayLabel(item.day, todayYmd).label}</span>}
        </div>
      </div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onPick(item)}
        aria-label="Pick a day"
        title="Pick a day"
        aria-pressed={picked}
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer",
          picked ? "bg-primary text-primary-fg" : "text-fg-subtle hover:bg-surface-3 hover:text-fg",
        )}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

