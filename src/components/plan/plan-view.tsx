"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, GripVertical, Inbox, Redo2, Undo2, X } from "lucide-react";
import { tone } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
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
  startOfWeekDay,
  ticketStage,
  weekDays,
  type PlanColumn,
  type PlanEvent,
} from "@/lib/plan-model";
import { cn } from "@/lib/utils";
import type { TodayBoard } from "@/components/today/today-view";
import { SwipePager, type PagerHandle } from "./swipe-pager";
import { DragGhost, usePlanDrag, type PlanDrag } from "./plan-drag";
import { SubtaskList, SubtaskToggle, useCompleteGuard } from "@/components/today/subtasks";
import { enqueueSubtaskEdit, itemSubtasks } from "@/lib/offline/subtask-edits";

export type PlanBoard = TodayBoard;
type Feed = { id: string; name: string; color: string };
type View = "month" | "week";
type Override = { day?: string | null; done?: boolean };
/** One undoable edit. */
type Change = { kind: "day"; item: TaskItem; from: string | null; to: string | null } | { kind: "done"; item: TaskItem; done: boolean };

/** Entries shown in a desktop month cell before "+n more". */
const MONTH_CELL_LIMIT = 3;
/** Hovering a dragged item over an arrow turns the page after this long. */
const NAV_HOVER_MS = 550;

const isCompact = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
const firstLine = (s: string) => s.split("\n")[0];
const dayTitle = (day: string, today: string) => {
  const { label, sublabel } = dayLabel(day, today);
  return sublabel ? `${label}, ${sublabel}` : label;
};

/**
 * Plan: tasks and tickets on a calendar, a tray of what still needs a day, and
 * your external calendars for context.
 *
 * Giving something a day — two ways, on every screen:
 *   • drag it onto a day (touch: hold, then drag); back onto the tray clears it;
 *   • tap its calendar button, tap a day, confirm.
 * Every move can be undone (and redone) from above the calendar.
 *
 * Wide screens: calendar | the chosen day + the tray. Phones: the calendar
 * stays pinned at the top with the tray scrolling under it; tapping a day
 * opens it as a sheet. Writes go through the offline outbox, like Today.
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
  const [sheetDay, setSheetDay] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<TaskItem | null>(null);
  const [pendingDay, setPendingDay] = React.useState<string | null>(null);
  const [trayTab, setTrayTab] = React.useState<"tasks" | "tickets">("tasks");
  const [boardFilter, setBoardFilter] = React.useState<string | null>(null);
  const [jump, setJump] = React.useState(0);
  const pager = React.useRef<PagerHandle>(null);
  /** The day to select once the pager lands (a tapped day of the next month, "Today"). */
  const selectOnShift = React.useRef<string | null>(null);

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

  // ── writes + history ───────────────────────────────────────────────────────
  const [history, setHistory] = React.useState<{ past: Change[]; future: Change[] }>({ past: [], future: [] });

  function writeDay(item: TaskItem, day: string | null) {
    setOverrides((o) => ({ ...o, [item.id]: { ...o[item.id], day } }));
    if (item.kind === "note") {
      sync.enqueue({ kind: "note.patch", id: item.id, body: { scheduledDay: day }, optimistic: { scheduledDay: day } });
    } else {
      const dueDate = dueFromDay(day);
      sync.enqueue({ kind: "ticket.patch", id: item.id, body: { dueDate }, optimistic: { dueDate } });
    }
  }

  function writeDone(item: TaskItem, done: boolean) {
    setOverrides((o) => ({ ...o, [item.id]: { ...o[item.id], done } }));
    const doneOn = done ? todayYmd : null;
    sync.enqueue({ kind: "note.patch", id: item.id, body: { doneOn }, optimistic: { doneOn } });
  }

  /** Show where a change put things: the day it landed on is selected and in view. */
  function reveal(day: string | null) {
    if (!day) return;
    setSelectedDay(day);
    const d = parseYmd(day);
    const visible = view === "month" ? d.getMonth() === anchor.getMonth() && d.getFullYear() === anchor.getFullYear() : week.some((w) => ymd(w) === day);
    if (!visible) {
      setAnchor(d);
      setJump((j) => j + 1);
    }
  }

  function apply(c: Change, dir: "do" | "undo") {
    if (c.kind === "day") {
      const day = dir === "do" ? c.to : c.from;
      writeDay(c.item, day);
      return day;
    }
    writeDone(c.item, dir === "do" ? c.done : !c.done);
    return null;
  }

  // The ref is the truth (handlers from older renders, like a toast's Undo, read it); state re-renders.
  const historyRef = React.useRef(history);
  function commitHistory(h: { past: Change[]; future: Change[] }) {
    historyRef.current = h;
    setHistory(h);
  }

  function record(c: Change, message?: { title: string; description?: string }) {
    apply(c, "do");
    commitHistory({ past: [...historyRef.current.past.slice(-49), c], future: [] });
    if (message) toast({ ...message, variant: "success", actionLabel: "Undo", duration: 5000, onAction: undo });
  }

  function undo() {
    const h = historyRef.current;
    const c = h.past[h.past.length - 1];
    if (!c) return;
    commitHistory({ past: h.past.slice(0, -1), future: [c, ...h.future] });
    reveal(apply(c, "undo"));
    toast({ title: "Undone", description: describe(c, "undo", todayYmd) });
  }

  function redo() {
    const h = historyRef.current;
    const c = h.future[0];
    if (!c) return;
    commitHistory({ past: [...h.past, c], future: h.future.slice(1) });
    reveal(apply(c, "do"));
    toast({ title: "Redone", description: describe(c, "do", todayYmd) });
  }

  function setDay(item: TaskItem, day: string | null) {
    const from = item.kind === "note" ? item.note.scheduledDay : item.day;
    if (from === day) return;
    record({ kind: "day", item, from, to: day }, { title: day ? `Planned for ${dayTitle(day, todayYmd)}` : "Date cleared", description: firstLine(item.title).slice(0, 80) });
    reveal(day);
  }

  const guard = useCompleteGuard();

  async function toggleDone(item: TaskItem) {
    if (item.kind !== "note") return;
    if (!item.done) {
      const choice = await guard.confirm(item.title, item.note.subtasks);
      if (!choice) return;
      if (choice === "all") {
        const all = (item.note.subtasks ?? []).map((s) => ({ ...s, completed: true }));
        sync.enqueue({ kind: "note.patch", id: item.id, body: { subtasks: all }, optimistic: { subtasks: all } });
      }
    }
    record({ kind: "done", item, done: !item.done });
  }

  // ⌘Z / ⇧⌘Z (Ctrl on Windows/Linux) — outside text fields.
  const undoRef = React.useRef({ undo, redo });
  React.useEffect(() => {
    undoRef.current = { undo, redo };
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" && e.key.toLowerCase() !== "y") return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault();
      if (e.key.toLowerCase() === "y" || e.shiftKey) undoRef.current.redo();
      else undoRef.current.undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function openTicket(id: string) {
    router.push(`/plan?ticket=${id}`, { scroll: false });
  }

  // ── choose-a-day: pick an item, tap a day, confirm ─────────────────────────
  function startPick(item: TaskItem) {
    setSheetDay(null);
    setPendingDay(null);
    setPicked((p) => (p?.id === item.id ? null : item));
  }
  function endPick() {
    setPicked(null);
    setPendingDay(null);
  }
  function confirmPick() {
    if (picked && pendingDay) setDay(picked, pendingDay);
    endPick();
  }
  React.useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && endPick();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picked]);

  // ── drag & drop ────────────────────────────────────────────────────────────
  const drag = usePlanDrag(endPick, (item, target) => {
    if (target === "tray") {
      if (item.day) setDay(item, null);
    } else if (target.startsWith("day:")) {
      setDay(item, target.slice(4));
    }
  });
  const dragging = drag.active?.item ?? null;
  const over = drag.active?.over ?? null;
  // Held over an arrow, the calendar turns — and keeps turning while you wait.
  React.useEffect(() => {
    if (!over?.startsWith("nav:")) return;
    const dir = Number(over.slice(4)) as -1 | 1;
    const id = setInterval(() => pager.current?.go(dir), NAV_HOVER_MS + 350);
    const first = setTimeout(() => pager.current?.go(dir), NAV_HOVER_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [over]);

  // ── calendar geometry + events ─────────────────────────────────────────────
  const weeks = React.useMemo(() => monthWeeks(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const week = React.useMemo(() => weekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  // Fetch the neighbours too, so a swipe slides in a calendar that's already filled.
  const [from, to] = React.useMemo(() => {
    if (view === "month") {
      const prev = monthWeeks(shiftAnchor(anchor, "month", -1), weekStartsOn);
      const next = monthWeeks(shiftAnchor(anchor, "month", 1), weekStartsOn);
      return [ymd(prev[0][0]), ymd(next[next.length - 1][6])];
    }
    return [ymd(weekDays(shiftAnchor(anchor, "week", -1), weekStartsOn)[0]), ymd(weekDays(shiftAnchor(anchor, "week", 1), weekStartsOn)[6])];
  }, [view, anchor, weekStartsOn]);
  const { events, errors } = useCalendarEvents(feeds.length > 0, from, to);
  const evByDay = React.useMemo(() => eventsByDay(events), [events]);
  const feedColor = React.useMemo(() => new Map(feeds.map((f) => [f.id, f.color])), [feeds]);

  const rangeLabel =
    view === "month"
      ? anchor.toLocaleDateString(LOCALE, { month: "long", year: "numeric" })
      : weekRange(week[0], week[6], now);
  const periodsFromNow =
    view === "month"
      ? (now.getFullYear() - anchor.getFullYear()) * 12 + now.getMonth() - anchor.getMonth()
      : Math.round((startOfWeekDay(now, weekStartsOn).getTime() - startOfWeekDay(anchor, weekStartsOn).getTime()) / (7 * 86_400_000));

  function onShift(dir: -1 | 1) {
    const next = shiftAnchor(anchor, view, dir);
    setAnchor(next);
    const want = selectOnShift.current;
    selectOnShift.current = null;
    const days = view === "month" ? null : weekDays(next, weekStartsOn).map(ymd);
    const inPeriod = (d: string) => (days ? days.includes(d) : parseYmd(d).getMonth() === next.getMonth() && parseYmd(d).getFullYear() === next.getFullYear());
    setSelectedDay(want ?? (inPeriod(todayYmd) ? todayYmd : days ? days[0] : ymd(next)));
  }

  function goToday() {
    if (periodsFromNow === 0) return setSelectedDay(todayYmd);
    if (Math.abs(periodsFromNow) === 1) {
      selectOnShift.current = todayYmd;
      pager.current?.go(periodsFromNow as -1 | 1);
      return;
    }
    setAnchor(startOfDay(now));
    setSelectedDay(todayYmd);
    setJump((j) => j + 1);
  }

  function switchView(v: View) {
    if (v === view) return;
    setView(v);
    setAnchor(parseYmd(selectedDay));
  }

  function dayTapped(day: string) {
    if (picked) {
      setPendingDay(day);
      return;
    }
    setSelectedDay(day);
    const d = parseYmd(day);
    if (view === "month" && (d.getMonth() !== anchor.getMonth() || d.getFullYear() !== anchor.getFullYear())) {
      selectOnShift.current = day;
      pager.current?.go(day < ymd(anchor) ? -1 : 1);
    }
    if (isCompact()) setSheetDay(day);
  }

  const cellProps = (day: string, preview: boolean): CellProps => ({
    day,
    todayYmd,
    items: plan.itemsByDay.get(day) ?? [],
    events: evByDay.get(day) ?? [],
    feedColor,
    preview,
    selected: day === selectedDay,
    target: day === pendingDay,
    over: over === `day:${day}`,
    drag,
    onTap: () => dayTapped(day),
    onToggle: toggleDone,
    onOpenTicket: openTicket,
  });

  const armed = !!picked || !!dragging;
  const renderPage = (o: -1 | 0 | 1) => {
    const preview = o !== 0;
    let page: React.ReactNode;
    if (view === "month") {
      const a = preview ? shiftAnchor(anchor, "month", o) : anchor;
      const ws = preview ? monthWeeks(a, weekStartsOn) : weeks;
      page = (
        <div className={cn("rounded-2xl border border-border bg-surface transition-shadow max-lg:p-1 lg:overflow-hidden", armed && !preview && "border-primary/50 ring-2 ring-primary/25")}>
          {ws.map((w, i) => (
            <div key={i} className={cn("grid grid-cols-7", i > 0 && "lg:border-t lg:border-border")}>
              {w.map((d, j) => (
                <MonthCell key={ymd(d)} {...cellProps(ymd(d), preview)} inMonth={d.getMonth() === a.getMonth()} edge={j === 0} />
              ))}
            </div>
          ))}
        </div>
      );
    } else {
      const days = preview ? weekDays(shiftAnchor(anchor, "week", o), weekStartsOn) : week;
      page = (
        <>
          <div className={cn("grid grid-cols-7 gap-0.5 rounded-2xl border border-border bg-surface p-1 lg:hidden", armed && !preview && "border-primary/50 ring-2 ring-primary/25")}>
            {days.map((d) => (
              <StripCell key={ymd(d)} {...cellProps(ymd(d), preview)} />
            ))}
          </div>
          <div className="hidden lg:block">
            <WeekdayHeader days={days} withDates todayYmd={todayYmd} selectedDay={selectedDay} onPick={preview ? undefined : dayTapped} />
            <div className={cn("grid grid-cols-7 overflow-hidden rounded-2xl border border-border bg-surface", armed && !preview && "border-primary/50 ring-2 ring-primary/25")}>
              {days.map((d, j) => (
                <WeekColumn key={ymd(d)} {...cellProps(ymd(d), preview)} edge={j === 0} />
              ))}
            </div>
          </div>
        </>
      );
    }
    return preview ? page : <div key={`${view}:${jump}`} className={jump ? "animate-fade-in" : undefined}>{page}</div>;
  };

  const trayCounts = {
    tasks: plan.tray.tasks.overdue.length + plan.tray.tasks.undated.length,
    tickets: plan.tray.tickets.overdue.length + plan.tray.tickets.undated.length,
  };
  const lastChange = history.past[history.past.length - 1];
  const nextChange = history.future[0];

  return (
    <>
      <div className="mx-auto w-full max-w-[96rem] px-4 pt-3 pb-32 md:px-8 lg:pt-8">
        {/* Title + view */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight lg:text-3xl">Plan</h1>
            <p className="mt-0.5 hidden text-sm text-fg-muted lg:block">Give every task a day — drag it onto the calendar, or tap its calendar button and pick one.</p>
          </div>
          <div role="tablist" aria-label="Calendar view" className="flex shrink-0 rounded-xl bg-surface-2 p-0.5 text-sm">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => switchView(v)}
                className={cn("rounded-lg px-3 py-1 capitalize transition-colors cursor-pointer", view === v ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 grid min-w-0 grid-cols-1 gap-4 lg:mt-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
          {/* Calendar — pinned on phones so the tray scrolls under it */}
          <section className="sticky top-0 z-20 -mx-4 min-w-0 bg-bg/95 px-4 pt-2 pb-3 backdrop-blur-md max-lg:border-b max-lg:border-border/70 md:-mx-8 md:px-8 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <div className="flex items-center gap-2">
              <span key={rangeLabel} className="min-w-0 flex-1 truncate font-display text-lg font-medium animate-fade-in lg:text-xl">
                {rangeLabel}
              </span>
              <div className="flex items-center rounded-xl border border-border bg-surface">
                <IconButton onClick={undo} disabled={!lastChange} label={lastChange ? `Undo — ${describe(lastChange, "undo", todayYmd)}` : "Nothing to undo"} className="rounded-l-xl">
                  <Undo2 className="h-4 w-4" />
                </IconButton>
                <IconButton onClick={redo} disabled={!nextChange} label={nextChange ? `Redo — ${describe(nextChange, "do", todayYmd)}` : "Nothing to redo"} className="rounded-r-xl border-l border-border">
                  <Redo2 className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="flex items-center rounded-xl border border-border bg-surface">
                <IconButton onClick={() => pager.current?.go(-1)} label={`Previous ${view}`} className="rounded-l-xl" drop="nav:-1" over={over === "nav:-1"}>
                  <ChevronLeft className="h-4 w-4" />
                </IconButton>
                <button
                  onClick={goToday}
                  disabled={periodsFromNow === 0 && selectedDay === todayYmd}
                  className="h-8 border-x border-border px-2.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 cursor-pointer disabled:cursor-default"
                >
                  Today
                </button>
                <IconButton onClick={() => pager.current?.go(1)} label={`Next ${view}`} className="rounded-r-xl" drop="nav:1" over={over === "nav:1"}>
                  <ChevronRight className="h-4 w-4" />
                </IconButton>
              </div>
            </div>

            {(feeds.length > 0 || errors.length > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
                {feeds.map((f) => (
                  <span key={f.id} className="hidden items-center gap-1.5 lg:inline-flex">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(f.color).dot }} />
                    <span dir="auto">{f.name}</span>
                  </span>
                ))}
                {errors.map((e) => (
                  <span key={e.feedId} className="inline-flex items-center gap-1 text-danger" title={e.message}>
                    <AlertTriangle className="h-3.5 w-3.5" /> {e.name}: {e.message}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2.5">
              {view === "month" && <WeekdayHeader days={weeks[0]} />}
              <SwipePager ref={pager} render={renderPage} onShift={onShift} disabled={!!dragging} />
            </div>
            {feeds.length === 0 && (
              <Link href="/settings#calendars" className="mt-3 hidden items-center gap-1.5 text-xs text-fg-subtle hover:text-fg lg:inline-flex">
                <CalendarPlus className="h-3.5 w-3.5" /> Show your Google Calendar here
              </Link>
            )}
          </section>

          {/* Wide: the chosen day above the tray */}
          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)]">
            <DayPanel
              {...cellProps(selectedDay, false)}
              selected={false}
              onPick={startPick}
              pickedId={picked?.id ?? null}
            />
            <Tray
              tab={trayTab}
              onTab={setTrayTab}
              counts={trayCounts}
              plan={plan}
              boards={boards}
              columns={columns}
              boardFilter={boardFilter}
              onBoardFilter={setBoardFilter}
              pickedId={picked?.id ?? null}
              onPick={startPick}
              onOpenTicket={openTicket}
              drag={drag}
              dimmed={!!picked}
            />
          </div>
        </div>
      </div>

      {/* Phones: a day opens as a sheet */}
      <Modal open={sheetDay != null} onClose={() => setSheetDay(null)} title={sheetDay ? dayTitle(sheetDay, todayYmd) : ""} size="md">
        {sheetDay && <DayList {...cellProps(sheetDay, false)} onPick={startPick} pickedId={null} draggable={false} />}
      </Modal>
      {guard.dialog}

      {picked && (
        <PickBar
          item={picked}
          day={pendingDay}
          todayYmd={todayYmd}
          counts={pendingDay ? { items: (plan.itemsByDay.get(pendingDay) ?? []).filter((i) => i.id !== picked.id).length, events: (evByDay.get(pendingDay) ?? []).length } : null}
          onConfirm={confirmPick}
          onBack={() => setPendingDay(null)}
          onClear={
            picked.day
              ? () => {
                  setDay(picked, null);
                  endPick();
                }
              : undefined
          }
          onClose={endPick}
        />
      )}

      <DragGhost active={drag.active} attach={drag.attachGhost}>
        {dragging && (
          <>
            <DropHint over={over} item={dragging} todayYmd={todayYmd} />
            <ItemChip item={dragging} roomy overlay />
          </>
        )}
      </DragGhost>
    </>
  );
}

/** "Oct 18 – 24", "Oct 25 – Nov 1"; the year only when it isn't this one. */
function weekRange(a: Date, b: Date, now: Date) {
  const year = a.getFullYear() !== now.getFullYear() || b.getFullYear() !== now.getFullYear() ? `, ${b.getFullYear()}` : "";
  const start = a.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
  const end = a.getMonth() === b.getMonth() ? String(b.getDate()) : b.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
  return `${start} – ${end}${year}`;
}

function describe(c: Change, dir: "do" | "undo", todayYmd: string) {
  const title = `“${firstLine(c.item.title).slice(0, 40)}”`;
  if (c.kind === "done") return `${title} ${(dir === "do") === c.done ? "done" : "not done"}`;
  const day = dir === "do" ? c.to : c.from;
  return day ? `${title} → ${dayTitle(day, todayYmd)}` : `${title} → no date`;
}

function IconButton({
  onClick,
  disabled,
  label,
  className,
  drop,
  over,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
  drop?: string;
  over?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-drop={drop}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default",
        over && "bg-primary text-primary-fg hover:bg-primary hover:text-primary-fg",
        className,
      )}
    >
      {children}
    </button>
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

type CellProps = {
  day: string;
  todayYmd: string;
  items: TaskItem[];
  events: PlanEvent[];
  feedColor: Map<string, string>;
  /** A neighbouring page in the pager: a picture, not a target. */
  preview: boolean;
  selected: boolean;
  /** The day a picked item is about to go to. */
  target: boolean;
  /** A dragged item is over it. */
  over: boolean;
  drag: PlanDrag;
  onTap: () => void;
  onToggle: (item: TaskItem) => void;
  onOpenTicket: (id: string) => void;
};

const tapHandler = (onTap: () => void) => (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest("button, a")) return;
  onTap();
};

function WeekdayHeader({
  days,
  withDates,
  todayYmd,
  selectedDay,
  onPick,
}: {
  days: Date[];
  withDates?: boolean;
  todayYmd?: string;
  selectedDay?: string;
  onPick?: (day: string) => void;
}) {
  return (
    <div className="mb-1.5 grid grid-cols-7 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle lg:px-0.5">
      {days.map((d) => {
        const day = ymd(d);
        if (!withDates) {
          return (
            <div key={day} className="text-center lg:px-1.5 lg:text-start">
              {d.toLocaleDateString(LOCALE, { weekday: "short" })}
            </div>
          );
        }
        return (
          <button
            key={day}
            type="button"
            onClick={() => onPick?.(day)}
            className={cn("flex items-baseline gap-1.5 rounded-lg px-2 py-1 text-start cursor-pointer hover:text-fg", day === todayYmd && "text-fg", day === selectedDay && "bg-surface-2 text-fg")}
          >
            {d.toLocaleDateString(LOCALE, { weekday: "short" })}
            <span className={cn("font-display text-sm normal-case tracking-normal", day === todayYmd && "rounded-full bg-primary px-1.5 text-primary-fg")}>{d.getDate()}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The day number: a circle on phones (iOS-style), a small pill on wide screens. */
function DayNumber({ day, todayYmd, inMonth = true, selected, target, over, wideLabel }: { day: string; todayYmd: string; inMonth?: boolean; selected: boolean; target: boolean; over: boolean; wideLabel?: string }) {
  const d = parseYmd(day);
  const isToday = day === todayYmd;
  let tone: string;
  if (over) tone = "bg-primary text-primary-fg font-semibold scale-110 lg:scale-100";
  else if (target) tone = "ring-2 ring-primary text-fg font-semibold";
  else if (isToday) tone = cn("font-semibold lg:bg-primary lg:text-primary-fg", selected ? "bg-primary text-primary-fg" : "text-primary");
  else if (!inMonth) tone = "text-fg-subtle/35";
  else if (selected) tone = "max-lg:bg-surface-3 max-lg:text-fg font-semibold lg:text-fg";
  else tone = day < todayYmd ? "text-fg-subtle" : "text-fg";
  return (
    <span
      className={cn(
        "grid h-8 min-w-8 place-items-center rounded-full tabular-nums transition-[transform,background-color] duration-150 lg:w-fit",
        "text-[0.9375rem] lg:h-6 lg:min-w-6 lg:px-1.5 lg:text-xs",
        tone,
      )}
    >
      <span>
        {wideLabel && <span className="hidden lg:inline">{wideLabel} </span>}
        {d.getDate()}
      </span>
    </span>
  );
}

function Dots({ items, events, feedColor, max = 4, faded }: { items: TaskItem[]; events: PlanEvent[]; feedColor: Map<string, string>; max?: number; faded?: boolean }) {
  const all = [...events.map((e) => ({ key: e.id, color: tone(feedColor.get(e.feedId) ?? "blue").dot, done: false })), ...items.map((i) => ({ key: i.id, color: i.kind === "ticket" ? tone(i.ticket.board.color).dot : "var(--color-fg)", done: i.done }))];
  return (
    <div className={cn("flex h-1.5 justify-center gap-[3px]", faded && "opacity-35")}>
      {all.slice(0, max).map((x) => (
        <span key={x.key} className={cn("h-1.5 w-1.5 rounded-full", x.done && "opacity-35")} style={{ backgroundColor: x.color }} />
      ))}
    </div>
  );
}

function MonthCell({ inMonth, edge, ...p }: CellProps & { inMonth: boolean; edge: boolean }) {
  const date = parseYmd(p.day);
  const entries = [...p.events.map((e) => ({ kind: "event" as const, e })), ...p.items.map((item) => ({ kind: "item" as const, item }))];
  const shown = entries.slice(0, MONTH_CELL_LIMIT);
  const more = entries.length - shown.length;
  const wideLabel = date.getDate() === 1 ? date.toLocaleDateString(LOCALE, { month: "short" }) : undefined;
  return (
    <div
      data-drop={p.preview ? undefined : `day:${p.day}`}
      onClick={tapHandler(p.onTap)}
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col items-center gap-1 py-1 transition-colors select-none",
        "lg:block lg:min-h-[7.25rem] lg:p-1.5",
        !edge && "lg:border-l lg:border-border",
        inMonth ? "lg:hover:bg-surface-2/40" : "lg:bg-bg",
        p.selected && "lg:bg-surface-2/70",
        p.target && "lg:bg-primary-soft/60 lg:shadow-[inset_0_0_0_2px_var(--color-primary)]",
        p.over && "lg:bg-primary-soft lg:shadow-[inset_0_0_0_2px_var(--color-primary)]",
      )}
    >
      <DayNumber day={p.day} todayYmd={p.todayYmd} inMonth={inMonth} selected={p.selected} target={p.target} over={p.over} wideLabel={wideLabel} />
      <div className="lg:hidden">
        <Dots items={p.items} events={p.events} feedColor={p.feedColor} faded={!inMonth} />
      </div>
      <div className={cn("mt-1 hidden space-y-0.5 lg:block", !inMonth && "opacity-45")}>
        {shown.map((x) =>
          x.kind === "event" ? (
            <EventChip key={x.e.id} event={x.e} color={p.feedColor.get(x.e.feedId) ?? "blue"} />
          ) : (
            <DayChip key={x.item.id} item={x.item} {...p} />
          ),
        )}
        {more > 0 && <div className="rounded-md px-1.5 py-0.5 text-[0.6875rem] text-fg-subtle hover:text-fg">+{more} more</div>}
      </div>
      {p.over && (
        <span className="pointer-events-none absolute inset-x-1 bottom-1 hidden rounded-md bg-primary py-0.5 text-center text-[0.625rem] font-medium text-primary-fg lg:block">Drop here</span>
      )}
    </div>
  );
}

/** Phones, week view: seven days in a row — tap one to open it. */
function StripCell(p: CellProps) {
  const d = parseYmd(p.day);
  const n = p.items.length + p.events.length;
  return (
    <div
      data-drop={p.preview ? undefined : `day:${p.day}`}
      onClick={tapHandler(p.onTap)}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-xl py-2 transition-colors select-none",
        p.over && "bg-primary-soft",
        p.selected && !p.over && "bg-surface-2",
      )}
    >
      <span className={cn("text-[0.625rem] font-medium uppercase tracking-wider", p.day === p.todayYmd ? "text-primary" : "text-fg-subtle")}>{d.toLocaleDateString(LOCALE, { weekday: "narrow" })}</span>
      <DayNumber day={p.day} todayYmd={p.todayYmd} selected={p.selected} target={p.target} over={p.over} />
      <Dots items={p.items} events={p.events} feedColor={p.feedColor} max={3} />
      <span className="h-3 text-[0.625rem] tabular-nums text-fg-subtle">{n > 3 ? `+${n - 3}` : ""}</span>
    </div>
  );
}

function WeekColumn({ edge, ...p }: CellProps & { edge: boolean }) {
  return (
    <div
      data-drop={p.preview ? undefined : `day:${p.day}`}
      onClick={tapHandler(p.onTap)}
      className={cn(
        "relative min-h-[30rem] min-w-0 cursor-pointer space-y-1 p-1.5 transition-colors",
        !edge && "border-l border-border",
        p.day === p.todayYmd && "bg-surface-2/40",
        p.selected && "bg-surface-2/70",
        p.target && "bg-primary-soft/60 shadow-[inset_0_0_0_2px_var(--color-primary)]",
        p.over && "bg-primary-soft shadow-[inset_0_0_0_2px_var(--color-primary)]",
      )}
    >
      {p.events.map((e) => (
        <EventChip key={e.id} event={e} color={p.feedColor.get(e.feedId) ?? "blue"} roomy />
      ))}
      {p.items.map((item) => (
        <DayChip key={item.id} item={item} roomy {...p} />
      ))}
    </div>
  );
}

/** The chosen day, beside the calendar on wide screens. */
function DayPanel(p: CellProps & { onPick: (i: TaskItem) => void; pickedId: string | null }) {
  const { label, sublabel } = dayLabel(p.day, p.todayYmd);
  const n = p.items.length;
  return (
    <section
      data-drop={`day:${p.day}`}
      className={cn(
        "hidden max-h-[46%] min-h-0 shrink-0 flex-col rounded-2xl border border-border bg-surface transition-colors lg:flex",
        p.over && "border-primary bg-primary-soft/40 ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <span className="font-display text-[1.1rem] font-medium">{label}</span>
        <span className="text-xs text-fg-subtle">{sublabel}</span>
        <span className="ml-auto text-[0.6875rem] tabular-nums text-fg-subtle">
          {n} {n === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2.5">
        <DayList {...p} draggable />
      </div>
    </section>
  );
}

/** A day's events and items as rows — the wide day panel and the phone sheet. */
function DayList(p: CellProps & { onPick: (i: TaskItem) => void; pickedId: string | null; draggable: boolean }) {
  const empty = p.items.length === 0 && p.events.length === 0;
  return (
    <div className="space-y-1">
      {p.events.map((e) => (
        <EventChip key={e.id} event={e} color={p.feedColor.get(e.feedId) ?? "blue"} roomy />
      ))}
      {p.items.map((item) => (
        <DayRow key={item.id} item={item} {...p} />
      ))}
      {empty && (
        <p className="px-2 py-4 text-center text-xs text-fg-subtle">
          Nothing planned{p.draggable ? " — drop a task here." : "."}
        </p>
      )}
    </div>
  );
}

function DayRow({ item, draggable, drag, onToggle, onOpenTicket, onPick, pickedId }: { item: TaskItem; draggable: boolean; drag: PlanDrag; onToggle: (i: TaskItem) => void; onOpenTicket: (id: string) => void; onPick: (i: TaskItem) => void; pickedId: string | null }) {
  const title = firstLine(item.title);
  const subtasks = itemSubtasks(item);
  const [open, setOpen] = React.useState(false);
  const ticket = item.kind === "ticket" ? item.ticket : null;
  const lifted = drag.active?.item.id === item.id;
  return (
    <div
      {...(draggable ? drag.source(item, item.done) : {})}
      className={cn(
        "group/row flex items-start gap-2 rounded-xl px-2 py-1.5 transition-colors",
        draggable && !item.done && "cursor-grab",
        pickedId === item.id ? "bg-primary-soft" : "hover:bg-surface-2",
        lifted && "opacity-35",
      )}
    >
      <span className="flex h-8 shrink-0 items-center">
        <ItemMark item={item} onToggle={onToggle} roomy />
      </span>
      <div className="min-w-0 flex-1 py-1.5" dir={textDirection(title)}>
        {ticket ? (
          <button type="button" onClick={() => onOpenTicket(ticket.id)} className={cn("line-clamp-2 w-full text-start text-sm leading-5 cursor-pointer hover:underline", item.done && "text-fg-muted line-through")}>
            {ticket.number != null && <span className="text-fg-subtle">#{ticket.number} </span>}
            {title}
          </button>
        ) : (
          <span className={cn("line-clamp-2 text-sm leading-5", item.done && "text-fg-muted line-through")}>{title}</span>
        )}
        {(ticket || subtasks.length > 0) && (
          <span className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-fg-subtle">
            {ticket && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(ticket.board.color).dot }} />
                <span dir="auto">{ticket.board.name}</span>
              </span>
            )}
            {subtasks.length > 0 && <SubtaskToggle items={subtasks} open={open} onClick={() => setOpen((v) => !v)} />}
          </span>
        )}
        {subtasks.length > 0 && <SubtaskList items={subtasks} open={open} onEdit={(e) => enqueueSubtaskEdit(item, e)} readOnly={item.done} />}
      </div>
      {!item.done && (
        <button
          type="button"
          data-no-drag
          onClick={() => onPick(item)}
          aria-label="Move to another day"
          title="Move to another day"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg cursor-pointer"
        >
          <CalendarClock className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ── chips ─────────────────────────────────────────────────────────────────────

function EventChip({ event, color, roomy }: { event: PlanEvent; color: string; roomy?: boolean }) {
  const t = tone(color);
  const time = eventTime(event);
  return (
    <div
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

/** A task's check, or a ticket's board dot. */
function ItemMark({ item, onToggle, roomy }: { item: TaskItem; onToggle?: (i: TaskItem) => void; roomy?: boolean }) {
  if (item.kind === "ticket") {
    return <span className={cn("shrink-0 rounded-full", roomy ? "mx-1 h-2 w-2" : "mt-1 h-1.5 w-1.5")} style={{ backgroundColor: tone(item.ticket.board.color).dot }} />;
  }
  return (
    <button
      type="button"
      data-no-drag
      onClick={() => onToggle?.(item)}
      aria-label={item.done ? "Mark not done" : "Mark done"}
      data-checked={item.done}
      className={cn("kb-check shrink-0 cursor-pointer", roomy ? "!h-[1.125rem] !w-[1.125rem]" : "mt-px !h-3 !w-3 !border")}
    >
      <Check className={roomy ? "h-3 w-3" : "h-2 w-2"} strokeWidth={3} />
    </button>
  );
}

/** An item inside a calendar day: draggable on the live page, a picture on neighbours. */
function DayChip({ item, roomy, preview, drag, onToggle, onOpenTicket }: CellProps & { item: TaskItem; roomy?: boolean }) {
  if (preview) return <ItemChip item={item} roomy={roomy} />;
  const lifted = drag.active?.item.id === item.id;
  return (
    <div {...drag.source(item, item.done)} className={cn(lifted && "opacity-30")}>
      <ItemChip item={item} roomy={roomy} onToggle={onToggle} onOpenTicket={onOpenTicket} />
    </div>
  );
}

function ItemChip({ item, roomy, overlay, onToggle, onOpenTicket }: { item: TaskItem; roomy?: boolean; overlay?: boolean; onToggle?: (i: TaskItem) => void; onOpenTicket?: (id: string) => void }) {
  const title = firstLine(item.title);
  const ticket = item.kind === "ticket" ? item.ticket : null;
  return (
    <div
      dir={textDirection(title)}
      className={cn(
        "flex min-w-0 items-start gap-1.5 rounded-md text-start transition-colors",
        roomy ? "px-2 py-1.5 text-[0.8125rem] leading-5" : "px-1.5 py-0.5 text-[0.6875rem] leading-4",
        overlay ? "rounded-xl border border-border-strong bg-surface shadow-xl" : item.done ? "bg-transparent" : "cursor-grab bg-surface-2/80 hover:bg-surface-3",
        item.done && !overlay && "opacity-60",
      )}
    >
      <span className={cn("flex shrink-0", roomy ? "mt-0.5" : "")}>
        <ItemMark item={item} onToggle={onToggle} roomy={roomy && !ticket} />
      </span>
      {ticket && !overlay ? (
        <button
          type="button"
          onClick={() => onOpenTicket?.(ticket.id)}
          className={cn("min-w-0 flex-1 text-start cursor-pointer", roomy ? "line-clamp-2" : "truncate", item.done && "line-through")}
          title={title}
        >
          {ticket.number != null && <span className="text-fg-subtle">#{ticket.number} </span>}
          {title}
        </button>
      ) : (
        <span className={cn("min-w-0 flex-1", roomy ? "line-clamp-2" : "truncate", item.done && "line-through")} title={title}>
          {ticket?.number != null && <span className="text-fg-subtle">#{ticket.number} </span>}
          {title}
        </span>
      )}
    </div>
  );
}

/** Above the dragged item: where it will land. */
function DropHint({ over, item, todayYmd }: { over: string | null; item: TaskItem; todayYmd: string }) {
  let text: string;
  let live = true;
  if (over?.startsWith("day:")) text = `→ ${dayTitle(over.slice(4), todayYmd)}`;
  else if (over === "tray") text = item.day ? "Clear the date" : "Stays unplanned";
  else if (over?.startsWith("nav:")) text = over === "nav:1" ? "Next →" : "← Previous";
  else {
    text = "Drop on a day";
    live = false;
  }
  return (
    <div className="mb-1.5 flex">
      <span className={cn("rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium shadow-md", live ? "bg-primary text-primary-fg" : "border border-border bg-surface text-fg-muted")}>{text}</span>
    </div>
  );
}

// ── choose a day ──────────────────────────────────────────────────────────────

function PickBar({
  item,
  day,
  todayYmd,
  counts,
  onConfirm,
  onBack,
  onClear,
  onClose,
}: {
  item: TaskItem;
  day: string | null;
  todayYmd: string;
  counts: { items: number; events: number } | null;
  onConfirm: () => void;
  onBack: () => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const title = firstLine(item.title).slice(0, 60);
  const already = counts ? [counts.items && `${counts.items} ${counts.items === 1 ? "item" : "items"}`, counts.events && `${counts.events} ${counts.events === 1 ? "event" : "events"}`].filter(Boolean).join(" · ") : "";
  const same = day != null && day === item.day;
  return (
    <div className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:bottom-6">
      <div role="dialog" aria-label="Choose a day" className="w-full max-w-md rounded-2xl border border-border-strong bg-surface p-3 shadow-2xl animate-slide-up-fade">
        <div className="flex items-start gap-3">
          <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl", day ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg kb-pick-armed")}>
            <CalendarPlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" dir="auto">
              {title}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {day ? (
                <>
                  Plan it for <span className="font-medium text-fg">{dayTitle(day, todayYmd)}</span>?{already && <span className="text-fg-subtle"> · already {already}</span>}
                </>
              ) : (
                <>Tap a day on the calendar{item.day ? ` (now ${dayTitle(item.day, todayYmd)})` : ""}.</>
              )}
            </p>
          </div>
          <button onClick={onClose} className="-mt-1 -mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer" aria-label="Cancel">
            <X className="h-4 w-4" />
          </button>
        </div>
        {(day || onClear) && (
          <div className="mt-2.5 flex justify-end gap-2">
            {day ? (
              <>
                <button onClick={onBack} className="h-9 rounded-xl px-3.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer">
                  Another day
                </button>
                <button
                  onClick={same ? onClose : onConfirm}
                  autoFocus
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover cursor-pointer"
                >
                  <Check className="h-4 w-4" /> {same ? "Keep it there" : "Plan it"}
                </button>
              </>
            ) : (
              onClear && (
                <button onClick={onClear} className="h-9 rounded-xl px-3.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer">
                  Remove the date
                </button>
              )
            )}
          </div>
        )}
      </div>
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
  pickedId,
  onPick,
  onOpenTicket,
  drag,
  dimmed,
}: {
  tab: "tasks" | "tickets";
  onTab: (t: "tasks" | "tickets") => void;
  counts: { tasks: number; tickets: number };
  plan: ReturnType<typeof buildPlan>;
  boards: PlanBoard[];
  columns: Map<string, PlanColumn>;
  boardFilter: string | null;
  onBoardFilter: (id: string | null) => void;
  pickedId: string | null;
  onPick: (item: TaskItem) => void;
  onOpenTicket: (id: string) => void;
  drag: PlanDrag;
  dimmed: boolean;
}) {
  const groups = tab === "tasks" ? plan.tray.tasks : plan.tray.tickets;
  const byBoard = (list: TaskItem[]) => (boardFilter ? list.filter((i) => i.kind === "ticket" && i.ticket.board.id === boardFilter) : list);
  const overdue = tab === "tickets" ? byBoard(groups.overdue) : groups.overdue;
  const undated = tab === "tickets" ? byBoard(groups.undated) : groups.undated;
  const boardsWithWork = boards.filter((b) => [...plan.tray.tickets.overdue, ...plan.tray.tickets.undated].some((i) => i.kind === "ticket" && i.ticket.board.id === b.id));
  const dragging = drag.active?.item ?? null;
  const canUnschedule = !!dragging?.day;
  const isOver = drag.active?.over === "tray";

  return (
    <aside
      data-drop="tray"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border bg-surface transition-[opacity,border-color,box-shadow]",
        canUnschedule && "border-dashed",
        isOver && canUnschedule && "border-solid border-primary ring-2 ring-primary/30",
        dimmed && "opacity-55",
      )}
    >
      <div className="px-4 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[1.1rem] font-medium">To plan</span>
          {canUnschedule ? (
            <span className="text-[0.6875rem] font-medium text-primary">Drop here to clear the date</span>
          ) : (
            <span className="flex items-center gap-1 text-[0.6875rem] text-fg-subtle">
              <GripVertical className="h-3 w-3" />
              <span className="lg:hidden">hold &amp; drag, or tap</span>
              <span className="hidden lg:inline">drag onto a day, or</span>
              <CalendarPlus className="h-3 w-3" />
            </span>
          )}
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
            <FilterChip active={!boardFilter} onClick={() => onBoardFilter(null)}>
              All
            </FilterChip>
            {boardsWithWork.map((b) => (
              <FilterChip key={b.id} active={boardFilter === b.id} onClick={() => onBoardFilter(boardFilter === b.id ? null : b.id)}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                <span dir="auto">{b.name}</span>
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 min-h-0 flex-1 px-2 pb-3 lg:overflow-y-auto lg:overscroll-contain">
        {overdue.length > 0 && (
          <TrayGroup label="Overdue" danger>
            {overdue.map((i) => (
              <TrayItem key={i.id} item={i} todayYmd={plan.todayYmd} columns={columns} picked={pickedId === i.id} onPick={onPick} onOpenTicket={onOpenTicket} drag={drag} />
            ))}
          </TrayGroup>
        )}
        <TrayGroup label={tab === "tasks" ? "No day yet" : "No due date"}>
          {undated.map((i) => (
            <TrayItem key={i.id} item={i} todayYmd={plan.todayYmd} columns={columns} picked={pickedId === i.id} onPick={onPick} onOpenTicket={onOpenTicket} drag={drag} />
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
  drag,
}: {
  item: TaskItem;
  todayYmd: string;
  columns: Map<string, PlanColumn>;
  picked: boolean;
  onPick: (i: TaskItem) => void;
  onOpenTicket: (id: string) => void;
  drag: PlanDrag;
}) {
  const title = firstLine(item.title);
  const ticket = item.kind === "ticket" ? item.ticket : null;
  const stage = ticket ? ticketStage(ticket, columns) : null;
  const lifted = drag.active?.item.id === item.id;
  return (
    <div
      {...drag.source(item)}
      className={cn(
        "group/tray flex cursor-grab items-center gap-1 rounded-xl border py-1.5 pr-1 pl-0.5 transition-[background-color,border-color,opacity]",
        picked ? "border-primary bg-primary-soft/60" : "border-transparent bg-surface-2/60 hover:border-border hover:bg-surface-2",
        lifted && "opacity-30",
      )}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-fg-subtle/50 transition-colors group-hover/tray:text-fg-muted" aria-hidden />
      <div className="min-w-0 flex-1 py-0.5" dir={textDirection(title)}>
        {ticket ? (
          <button type="button" onClick={() => onOpenTicket(ticket.id)} className="line-clamp-2 block w-full text-start text-[0.8125rem] leading-5 text-fg cursor-pointer hover:underline" title={title}>
            {title}
          </button>
        ) : (
          <span className="line-clamp-2 text-[0.8125rem] leading-5 text-fg" title={title}>
            {title}
          </span>
        )}
        {(ticket || (item.day && item.day < todayYmd)) && (
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
        )}
      </div>
      <button
        type="button"
        data-no-drag
        onClick={() => onPick(item)}
        aria-label="Choose a day"
        title="Choose a day"
        aria-pressed={picked}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer",
          picked ? "bg-primary text-primary-fg" : "text-fg-subtle hover:bg-surface-3 hover:text-fg",
        )}
      >
        <CalendarPlus className="h-4 w-4" />
      </button>
    </div>
  );
}
