"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Flag,
  MoreHorizontal,
  Mic,
  MicOff,
  Plus,
  Trash2,
  ArrowUpRight,
  FolderInput,
  Sparkles,
  Inbox,
  MessageSquare,
  ListChecks,
  Pencil,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/menu";
import { tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useDictation } from "@/components/notes/use-dictation";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { PRIORITIES, PRIORITY_META, type Priority } from "@/lib/constants";
import { priorityMeta } from "@/lib/display";
import { ymd, addDays, startOfDay, parseYmd, dueFromDay } from "@/lib/notes-schedule";
import { parseQuickAdd } from "@/lib/quick-add";
import { buildToday, dayLabel, LOCALE, type TaskItem, type TodayNote, type TodayTicket, type TodaySection, type SectionKey } from "@/lib/today-model";
import type { SerializedTicket } from "@/lib/serialize";
import * as sync from "@/lib/offline/sync-store";
import { clientId, toTodayTicket, type TodayData } from "@/lib/offline/today-sync";
import { textDirection } from "@/lib/text-direction";

const SERVER_SYNC_SNAPSHOT: sync.SyncSnapshot = { status: { online: true, syncing: false, pending: 0, authNeeded: false, baseAt: null, stale: false, syncedAt: 0 }, data: null };
const getServerSyncSnapshot = () => SERVER_SYNC_SNAPSHOT;

export type TodayBoard = {
  id: string;
  name: string;
  slug: string;
  color: string;
  columns: { id: string; name: string; isDone: boolean; stage?: string | null }[];
};

export type ActivityRow = {
  id: string;
  actorType: string;
  actorName: string;
  action: string;
  createdAt: string;
  ticket?: { id: string; title: string; number: number | null; boardSlug: string; boardName: string } | null;
  board?: { id: string; name: string; slug: string } | null;
  note?: { id: string; body: string } | null;
};

type Props = {
  /** Offline-sync partition (user + workspace); see lib/offline. */
  syncScope: string;
  tickets: TodayTicket[];
  notes: TodayNote[];
  boards: TodayBoard[];
  dictationLanguage: string;
  focusId?: string | null;
  compose?: boolean;
  /** Server "now" (ISO) for the first render; the client takes over after mount. */
  initialNow: string;
};

const SECTION_DEFAULT_OPEN: Record<SectionKey, boolean> = {
  overdue: true,
  today: true,
  tomorrow: true,
  week: true,
  later: false,
  inbox: true,
  done: false,
};

export function TodayView({ syncScope, tickets: initialTickets, notes: initialNotes, boards: initialBoards, dictationLanguage, focusId, compose, initialNow }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState<Record<SectionKey, boolean>>(SECTION_DEFAULT_OPEN);
  const [now, setNow] = React.useState(() => new Date(initialNow));
  React.useEffect(() => setNow(new Date()), []);

  // Offline-first: the list is the synced store (last server state + queued
  // edits, persisted on this device). The server render seeds it; a render
  // older than what the device holds (served from the offline cache) loses.
  const server = React.useMemo<TodayData>(
    () => ({ tickets: initialTickets, notes: initialNotes, boards: initialBoards }),
    [initialTickets, initialNotes, initialBoards],
  );
  React.useLayoutEffect(() => {
    sync.ingestServer(syncScope, server, Date.parse(initialNow));
  }, [syncScope, server, initialNow]);
  const snap = React.useSyncExternalStore(sync.subscribe, sync.getSnapshot, getServerSyncSnapshot);
  const data = snap.data ?? server;
  const { tickets, notes, boards } = data;

  // Pull fresh server state once the outbox drains, when the network returns
  // to a stale page, and after a rejected edit. Never while offline: a failed
  // RSC fetch makes Next fall back to a full page load.
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (sync.getSnapshot().status.online) router.refresh();
      }, 400);
    };
    const off = sync.onSyncEvent((e) => {
      if (e.type === "rejected") {
        toast({ title: "Couldn't sync a change", description: e.message, variant: "error" });
      }
      refreshSoon();
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [router, toast]);

  // Roll the day over at midnight without a reload.
  React.useEffect(() => {
    const tick = () => setNow(new Date());
    const msToMidnight = addDays(startOfDay(new Date()), 1).getTime() - Date.now() + 500;
    const t = setTimeout(tick, msToMidnight);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [now]);

  const model = React.useMemo(() => buildToday({ tickets, notes, now }), [tickets, notes, now]);
  const todayYmd = model.todayYmd;

  // ── mutations: every edit is a queued op (see lib/offline) ───────────────

  const patchNote = (id: string, body: Record<string, unknown>, optimistic: Partial<TodayNote>) =>
    sync.enqueue({ kind: "note.patch", id, body, optimistic });

  const patchTicket = (id: string, body: Record<string, unknown>, optimistic: Partial<TodayTicket>) =>
    sync.enqueue({ kind: "ticket.patch", id, body, optimistic });

  const moveTicket = (t: TodayTicket, columnId: string, subState: string | null, optimistic: Partial<TodayTicket>) =>
    sync.enqueue({ kind: "ticket.move", id: t.id, body: { columnId, position: 0, subState }, optimistic });

  function toggleDone(item: TaskItem) {
    if (item.kind === "note") {
      const n = item.note;
      const wasDone = n.doneOn != null;
      patchNote(n.id, { doneOn: wasDone ? null : todayYmd }, { doneOn: wasDone ? null : todayYmd });
      if (!wasDone) {
        toast({
          title: "Done",
          description: n.body.split("\n")[0].slice(0, 80),
          variant: "success",
          actionLabel: "Undo",
          duration: 6000,
          onAction: () => patchNote(n.id, { doneOn: null }, { doneOn: null }),
        });
      }
      return;
    }
    const t = item.ticket;
    if (t.isDone) {
      // Un-complete: back to the first non-done column of its board.
      const b = boards.find((x) => x.id === t.board.id);
      const target = b?.columns.find((c) => !c.isDone);
      if (!target) return;
      moveTicket(t, target.id, null, { isDone: false, completedAt: null, columnId: target.id, columnName: target.name });
      return;
    }
    if (!t.board.doneColumnId) {
      toast({ title: "This board has no Done column", description: "Add one in the board settings.", variant: "error" });
      return;
    }
    const previous = { columnId: t.columnId, subState: t.subState, columnName: t.columnName };
    const doneName = boards.find((x) => x.id === t.board.id)?.columns.find((c) => c.id === t.board.doneColumnId)?.name;
    moveTicket(t, t.board.doneColumnId, null, {
      isDone: true,
      completedAt: new Date().toISOString(),
      columnId: t.board.doneColumnId,
      subState: null,
      ...(doneName ? { columnName: doneName } : {}),
    });
    toast({
      title: "Done",
      description: t.title.slice(0, 80),
      variant: "success",
      actionLabel: "Undo",
      duration: 6000,
      onAction: () => moveTicket(t, previous.columnId, previous.subState, { isDone: false, completedAt: null, ...previous }),
    });
  }

  function reschedule(item: TaskItem, day: string | null) {
    if (item.kind === "note") return patchNote(item.id, { scheduledDay: day }, { scheduledDay: day });
    return patchTicket(item.id, { dueDate: dueFromDay(day) }, { dueDate: dueFromDay(day) });
  }

  function setPriority(item: TaskItem, priority: Priority) {
    if (item.kind === "note") return patchNote(item.id, { priority }, { priority });
    return patchTicket(item.id, { priority }, { priority });
  }

  function remove(item: TaskItem) {
    sync.enqueue(item.kind === "note" ? { kind: "note.delete", id: item.id } : { kind: "ticket.delete", id: item.id });
    toast({ title: "Deleted", description: "Restorable from Settings → Recently deleted for 30 days." });
  }

  async function moveNoteToBoard(n: TodayNote, board: TodayBoard) {
    const column = board.columns.find((c) => !c.isDone) ?? board.columns[0];
    if (!column) return;
    // Promoting creates a numbered ticket server-side: online only.
    const { status } = sync.getSnapshot();
    if (!status.online || status.pending > 0) {
      toast({ title: "Needs a connection", description: "Moving to a board works once your changes have synced.", variant: "error" });
      return;
    }
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/notes/${n.id}/promote`, {
        body: {
          boardId: board.id,
          columnId: column.id,
          title: n.body.split("\n")[0].slice(0, 200),
          description: n.body.split("\n").slice(1).join("\n").trim() || undefined,
          priority: n.priority !== "none" ? n.priority : undefined,
          dueDate: dueFromDay(n.scheduledDay),
        },
      });
      sync.updateBase((b) => ({
        ...b,
        notes: b.notes.filter((x) => x.id !== n.id),
        tickets: [...b.tickets.filter((x) => x.id !== ticket.id), toTodayTicket(ticket, b.boards)],
      }));
      toast({ title: `Moved to ${board.name}`, description: ticket.title, variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't move to board", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      router.refresh();
    }
  }

  function editNote(n: TodayNote, body: string) {
    const next = body.trim();
    if (!next || next === n.body) return;
    patchNote(n.id, { body: next }, { body: next });
  }

  async function quickAdd(text: string, dayOverride: string | null | undefined) {
    const parsed = parseQuickAdd(text, boards, new Date());
    const day = dayOverride === undefined ? parsed.day ?? todayYmd : dayOverride;
    const priority = parsed.priority ?? undefined;
    const nowIso = new Date().toISOString();
    if (day && day !== todayYmd) setOpen((o) => ({ ...o, [sectionFor(day, todayYmd)]: true }));
    if (parsed.board) {
      const board = boards.find((x) => x.id === parsed.board!.id)!;
      const column = board.columns.find((c) => !c.isDone) ?? board.columns[0];
      if (!column) return;
      const dueDate = dueFromDay(day);
      sync.enqueue({
        kind: "ticket.create",
        body: { boardId: board.id, columnId: column.id, title: parsed.title, priority, dueDate },
        ticket: {
          id: clientId(),
          title: parsed.title,
          number: null,
          priority: priority ?? "medium",
          dueDate,
          columnId: column.id,
          columnName: column.name,
          subState: null,
          completedAt: null,
          isDone: false,
          board: { id: board.id, name: board.name, slug: board.slug, color: board.color, doneColumnId: board.columns.find((c) => c.isDone)?.id ?? null },
          labels: [],
          subtasksDone: 0,
          subtasksTotal: 0,
          commentCount: 0,
          createdByType: "user",
          createdAt: nowIso,
        },
      });
      return;
    }
    if (day === null) setOpen((o) => ({ ...o, inbox: true }));
    sync.enqueue({
      kind: "note.create",
      body: { body: parsed.title, scheduledDay: day, priority },
      note: { id: clientId(), body: parsed.title, status: "inbox", scheduledDay: day, doneOn: null, priority: priority ?? "none", position: 1e9, createdAt: nowIso, updatedAt: nowIso, assignedAgent: null, ticket: null },
    });
  }

  // Deep link: scroll + highlight a row.
  React.useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`task-${focusId}`);
    if (!el) return;
    setOpen((o) => ({ ...o, later: true, done: true }));
    el.scrollIntoView({ block: "center" });
    el.classList.add("kb-today-flash");
    const t = setTimeout(() => el.classList.remove("kb-today-flash"), 1200);
    return () => clearTimeout(t);
  }, [focusId]);

  const visibleSections = model.sections.filter((s) => s.items.length > 0 || s.key === "today");

  return (
    <div className="min-w-0 space-y-5">
      <QuickAdd boards={boards} todayYmd={todayYmd} onAdd={quickAdd} dictationLanguage={dictationLanguage} autoFocus={!!compose} />

      {visibleSections.map((section) => (
        <Section
          key={section.key}
          section={section}
          open={open[section.key]}
          onToggle={() => setOpen((o) => ({ ...o, [section.key]: !o[section.key] }))}
          todayYmd={todayYmd}
          boards={boards}
          onToggleDone={toggleDone}
          onReschedule={reschedule}
          onPriority={setPriority}
          onDelete={remove}
          onMoveToBoard={moveNoteToBoard}
          onEditNote={editNote}
          focusId={focusId}
        />
      ))}
    </div>
  );
}

function sectionFor(day: string, todayYmd: string): SectionKey {
  if (day < todayYmd) return "overdue";
  if (day === todayYmd) return "today";
  if (day === ymd(addDays(parseYmd(todayYmd), 1))) return "tomorrow";
  if (day <= ymd(addDays(parseYmd(todayYmd), 7))) return "week";
  return "later";
}

// ── Quick add ────────────────────────────────────────────────────────────────

function QuickAdd({
  boards,
  todayYmd,
  onAdd,
  dictationLanguage,
  autoFocus,
}: {
  boards: TodayBoard[];
  todayYmd: string;
  onAdd: (text: string, dayOverride: string | null | undefined) => Promise<void>;
  dictationLanguage: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = React.useState("");
  const [dayOverride, setDayOverride] = React.useState<string | null | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const parsed = React.useMemo(() => (text.trim() ? parseQuickAdd(text, boards, new Date()) : null), [text, boards]);
  const effectiveDay = dayOverride === undefined ? parsed?.day ?? todayYmd : dayOverride;

  const dictation = useDictation((t) => setText((cur) => (cur ? cur.replace(/\s*$/, " ") : "") + t), dictationLanguage);

  React.useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  async function submit() {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await onAdd(v, dayOverride);
      setText("");
      setDayOverride(undefined);
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  }

  const dayChipLabel = effectiveDay === null ? "Inbox" : dayLabel(effectiveDay, todayYmd).label;

  return (
    <div className="kb-quickadd rounded-2xl p-2 pl-3">
      <div className="flex items-start gap-2">
        <span className="mt-2.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-fg">
          <Plus className="h-3.5 w-3.5" />
        </span>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          dir="auto"
          placeholder="Add a task…"
          className="min-h-10 max-h-40 w-full resize-none bg-transparent py-2.5 text-[0.95rem] leading-6 text-fg placeholder:text-fg-subtle focus:outline-none"
          style={{ height: "auto" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(160, el.scrollHeight) + "px";
          }}
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={dictation.toggle}
            aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
            className={cn(
              "mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer",
              dictation.listening ? "bg-danger-soft text-danger animate-pulse-soft" : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
            )}
          >
            {dictation.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-8 pb-1">
        <DayPicker value={effectiveDay} todayYmd={todayYmd} onChange={setDayOverride}>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[0.75rem] font-medium text-fg-muted hover:text-fg cursor-pointer">
            <CalendarDays className="h-3 w-3" /> {dayChipLabel} <ChevronDown className="h-3 w-3" />
          </span>
        </DayPicker>
        {parsed?.priority && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-medium" style={{ color: priorityMeta(parsed.priority).color, backgroundColor: "var(--color-surface-2)" }}>
            <Flag className="h-3 w-3" /> {PRIORITY_META[parsed.priority].label}
          </span>
        )}
        {parsed?.board && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-medium" style={{ backgroundColor: tone(parsed.board && boards.find((b) => b.id === parsed.board!.id)?.color || "slate").bg, color: tone(boards.find((b) => b.id === parsed.board!.id)?.color || "slate").fg }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(boards.find((b) => b.id === parsed.board!.id)?.color || "slate").dot }} />
            {parsed.board.name}
          </span>
        )}
        {dictation.status && <span className="text-[0.75rem] text-fg-subtle">{dictation.status}</span>}
        {!text && !dictation.status && (
          <span className="hidden text-[0.75rem] text-fg-subtle md:inline">
            Try “Call the bank tomorrow !high #Personal” — dates, priority and board are understood.
          </span>
        )}
        <span className="ml-auto">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            className="rounded-lg bg-primary px-3 py-1 text-[0.8125rem] font-medium text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-40 cursor-pointer"
          >
            Add
          </button>
        </span>
      </div>
    </div>
  );
}

export function DayPicker({
  value,
  todayYmd,
  onChange,
  children,
  align = "start",
}: {
  value: string | null;
  todayYmd: string;
  onChange: (day: string | null) => void;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const today = parseYmd(todayYmd);
  const options: { label: string; sub?: string; day: string | null }[] = [
    { label: "Today", day: todayYmd },
    { label: "Tomorrow", day: ymd(addDays(today, 1)) },
  ];
  for (let i = 2; i <= 6; i++) {
    const d = addDays(today, i);
    options.push({ label: d.toLocaleDateString(LOCALE, { weekday: "long" }), sub: d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" }), day: ymd(d) });
  }
  options.push({ label: "Next week", sub: addDays(today, 7).toLocaleDateString(LOCALE, { month: "short", day: "numeric" }), day: ymd(addDays(today, 7)) });
  options.push({ label: "No day (Inbox)", day: null });

  return (
    <Menu trigger={children} align={align} contentClassName="w-56">
      {(close) => (
        <>
          {options.map((o) => (
            <MenuItem
              key={o.label}
              active={value === o.day}
              onClick={() => {
                onChange(o.day);
                close();
              }}
            >
              <span className="flex-1">{o.label}</span>
              {o.sub && <span className="text-xs text-fg-subtle">{o.sub}</span>}
              {value === o.day && <Check className="h-3.5 w-3.5" />}
            </MenuItem>
          ))}
          <div className="mt-1 border-t border-border px-2 pt-2 pb-1">
            <input
              type="date"
              className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
              value={value ?? ""}
              onChange={(e) => {
                if (e.target.value) {
                  onChange(e.target.value);
                  close();
                }
              }}
            />
          </div>
        </>
      )}
    </Menu>
  );
}

// ── Sections & rows ──────────────────────────────────────────────────────────

const SECTION_TONE: Record<SectionKey, string> = {
  overdue: "text-danger",
  today: "text-fg",
  tomorrow: "text-fg",
  week: "text-fg",
  later: "text-fg-muted",
  inbox: "text-fg",
  done: "text-success",
};

function Section({
  section,
  open,
  onToggle,
  todayYmd,
  boards,
  focusId,
  ...actions
}: {
  section: TodaySection;
  open: boolean;
  onToggle: () => void;
  todayYmd: string;
  boards: TodayBoard[];
  focusId?: string | null;
  onToggleDone: (i: TaskItem) => void;
  onReschedule: (i: TaskItem, day: string | null) => void;
  onPriority: (i: TaskItem, p: Priority) => void;
  onDelete: (i: TaskItem) => void;
  onMoveToBoard: (n: TodayNote, b: TodayBoard) => void;
  onEditNote: (n: TodayNote, body: string) => void;
}) {
  const count = section.items.length;
  const isEmptyToday = section.key === "today" && count === 0;
  const Icon = section.key === "inbox" ? Inbox : section.key === "done" ? Check : null;

  return (
    <section className={cn("rounded-2xl border border-border bg-surface", section.key === "today" && "kb-today", section.key === "overdue" && "border-danger/30")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left cursor-pointer"
      >
        <span className={cn("grid h-5 w-5 place-items-center text-fg-subtle transition-transform", open && "rotate-90")}>
          <ChevronRight className="h-4 w-4" />
        </span>
        {Icon && <Icon className={cn("h-4 w-4", SECTION_TONE[section.key])} />}
        <span className={cn("font-display text-[1.15rem] font-medium leading-none", SECTION_TONE[section.key])}>{section.label}</span>
        {section.sublabel && <span className="text-xs text-fg-subtle">{section.sublabel}</span>}
        <span
          key={count}
          className={cn(
            "kb-count-pop ml-auto rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
            section.key === "overdue" && count > 0 ? "bg-danger text-white" : "bg-surface-2 text-fg-muted",
          )}
        >
          {count}
        </span>
      </button>

      {open && (
        <div className="animate-fade-in px-2 pb-2">
          {isEmptyToday && (
            <p className="px-3 pb-3 text-sm text-fg-subtle">Nothing on today&apos;s list. Add something above, or pull from Inbox.</p>
          )}
          {section.groups ? (
            section.groups.map((g) => (
              <div key={g.day} className="mb-1">
                <div className="flex items-baseline gap-2 px-3 pt-2 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{g.label}</span>
                  <span className="text-[0.6875rem] text-fg-subtle">{g.sublabel}</span>
                </div>
                {g.items.map((it) => (
                  <Row key={it.id} item={it} todayYmd={todayYmd} boards={boards} showDay={false} highlight={focusId === it.id} {...actions} />
                ))}
              </div>
            ))
          ) : (
            section.items.map((it) => (
              <Row
                key={it.id}
                item={it}
                todayYmd={todayYmd}
                boards={boards}
                showDay={section.key === "overdue" || section.key === "later" || section.key === "done"}
                highlight={focusId === it.id}
                {...actions}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

/** Ids completed from a row this session — their row in "Done" lands with a small entrance. */
const justCompleted = new Set<string>();
/** Check fills + mark draws + ring, then the row folds away and moves to Done. */
const COMPLETE_HOLD_MS = 480;
const COMPLETE_FOLD_MS = 280;

function Row({
  item,
  todayYmd,
  boards,
  showDay,
  highlight,
  onToggleDone,
  onReschedule,
  onPriority,
  onDelete,
  onMoveToBoard,
  onEditNote,
}: {
  item: TaskItem;
  todayYmd: string;
  boards: TodayBoard[];
  showDay: boolean;
  highlight?: boolean;
  onToggleDone: (i: TaskItem) => void;
  onReschedule: (i: TaskItem, day: string | null) => void;
  onPriority: (i: TaskItem, p: Priority) => void;
  onDelete: (i: TaskItem) => void;
  onMoveToBoard: (n: TodayNote, b: TodayBoard) => void;
  onEditNote: (n: TodayNote, body: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.title);
  const [phase, setPhase] = React.useState<"idle" | "completing" | "leaving">("idle");
  const [landed] = React.useState(() => justCompleted.delete(item.id) && item.done);
  const pm = priorityMeta(item.priority);
  const isTicket = item.kind === "ticket";
  const ticket = isTicket ? item.ticket : null;
  const note = !isTicket ? item.note : null;
  const queued = note?.status === "queued";
  const firstLine = item.title.split("\n")[0];
  const extra = item.title.split("\n").length > 1;
  const dayMeta = item.day ? dayLabel(item.day, todayYmd) : null;
  // Title and meta line follow the title's language, tickets and plain tasks alike:
  // a Hebrew task reads from the right, an English one from the left.
  const dir = textDirection(firstLine);

  // A server echo or undo that flips the item back resets the choreography.
  const [seenDone, setSeenDone] = React.useState(item.done);
  if (seenDone !== item.done) {
    setSeenDone(item.done);
    setPhase("idle");
  }

  function check() {
    if (phase !== "idle") return;
    if (item.done) {
      onToggleDone(item);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPhase("completing");
    try {
      navigator.vibrate?.(8);
    } catch {}
    setTimeout(() => setPhase("leaving"), reduce ? 0 : COMPLETE_HOLD_MS);
    setTimeout(() => {
      justCompleted.add(item.id);
      onToggleDone(item);
    }, reduce ? 0 : COMPLETE_HOLD_MS + COMPLETE_FOLD_MS);
    // If the row is still here (the write failed), bring it back.
    setTimeout(() => setPhase("idle"), COMPLETE_HOLD_MS + COMPLETE_FOLD_MS + 1500);
  }

  const titleEl = editing && note ? (
    <textarea
      autoFocus
      dir="auto"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        onEditNote(note, draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(item.title);
          setEditing(false);
        }
      }}
      rows={Math.min(6, draft.split("\n").length)}
      className="w-full resize-none rounded-md bg-surface-2 px-2 py-1 text-[0.95rem] leading-6 text-fg focus:outline-none"
    />
  ) : isTicket ? (
    <Link
      href={`/today?ticket=${item.id}`}
      scroll={false}
      className="kb-row-title line-clamp-2 block text-start text-[0.95rem] leading-6 text-fg hover:underline underline-offset-2 decoration-border-strong"
      title={item.title}
    >
      <span className="kb-strike">{firstLine}</span>
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => {
        setDraft(item.title);
        setEditing(true);
      }}
      className="kb-row-title line-clamp-2 block w-full text-start text-[0.95rem] leading-6 text-fg cursor-text"
      title={item.title}
    >
      <span className="kb-strike">{firstLine}</span>
      {extra && <span className="text-fg-subtle"> …</span>}
    </button>
  );

  return (
    <div className={cn("kb-row-wrap", phase === "leaving" && "is-leaving")}>
    <div
      id={`task-${item.id}`}
      className={cn(
        "group flex items-start gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-surface-2/70",
        item.done && "kb-row-done",
        highlight && "bg-primary-soft/50",
        phase !== "idle" && "is-completing",
        landed && "animate-row-in kb-row-landed",
      )}
    >
      <button
        type="button"
        onClick={check}
        disabled={queued}
        aria-label={item.done ? "Mark not done" : "Mark done"}
        data-checked={item.done || phase !== "idle"}
        className="kb-check mt-1 cursor-pointer disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1" dir={dir}>
        {titleEl}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-fg-subtle">
          {ticket && (
            <Link href={`/boards/${ticket.board.slug}`} className="inline-flex items-center gap-1 hover:text-fg" dir="auto">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(ticket.board.color).dot }} />
              {ticket.board.name}
              {ticket.number != null && <span className="text-fg-subtle/70">#{ticket.number}</span>}
            </Link>
          )}
          {ticket && !ticket.isDone && ticket.columnName && <span className="text-fg-subtle/80">{ticket.columnName}</span>}
          {ticket && ticket.subtasksTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3 w-3" /> {ticket.subtasksDone}/{ticket.subtasksTotal}
            </span>
          )}
          {ticket && ticket.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> {ticket.commentCount}
            </span>
          )}
          {ticket?.labels.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded-full px-1.5 py-px" style={{ backgroundColor: tone(l.color).bg, color: tone(l.color).fg }}>
              {l.name}
            </span>
          ))}
          {item.priority !== "none" && (
            <span className="inline-flex items-center gap-1" style={{ color: pm.color }}>
              <Flag className="h-3 w-3" /> {pm.label}
            </span>
          )}
          {showDay && dayMeta && (
            <span className={cn("inline-flex items-center gap-1", item.day && item.day < todayYmd && !item.done && "text-danger")}>
              <CalendarDays className="h-3 w-3" /> {dayMeta.label}
              {dayMeta.sublabel && ` · ${dayMeta.sublabel}`}
            </span>
          )}
          {queued && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" /> <span className="ai-shimmer">{note?.assignedAgent?.name ?? "Agent"} is filing this…</span>
            </span>
          )}
          {ticket?.createdByType === "agent" && !queued && (
            <span className="inline-flex items-center gap-1 text-fg-subtle/80" title="Added by your agent">
              <Sparkles className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <DayPicker value={item.day} todayYmd={todayYmd} onChange={(d) => onReschedule(item, d)} align="end">
          <span className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg cursor-pointer" aria-label="Schedule">
            <CalendarDays className="h-4 w-4" />
          </span>
        </DayPicker>
        <Menu
          align="end"
          contentClassName="w-52"
          trigger={
            <span className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg cursor-pointer" aria-label="More">
              <MoreHorizontal className="h-4 w-4" />
            </span>
          }
        >
          {(close) => (
            <>
              {note && (
                <MenuItem
                  onClick={() => {
                    setDraft(item.title);
                    setEditing(true);
                    close();
                  }}
                >
                  <Pencil className="h-4 w-4 text-fg-subtle" /> Edit
                </MenuItem>
              )}
              {ticket && (
                <MenuItem onClick={close}>
                  <Link href={`/boards/${ticket.board.slug}?ticket=${ticket.id}`} className="flex flex-1 items-center gap-2">
                    <ArrowUpRight className="h-4 w-4 text-fg-subtle" /> Open on board
                  </Link>
                </MenuItem>
              )}
              <div className="px-2.5 pt-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">Priority</div>
              <div className="flex items-center gap-1 px-2 pb-1">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    title={PRIORITY_META[p].label}
                    onClick={() => {
                      onPriority(item, p);
                      close();
                    }}
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-md hover:bg-surface-2 cursor-pointer",
                      item.priority === p && "bg-surface-2 ring-1 ring-border-strong",
                    )}
                  >
                    <Flag className="h-3.5 w-3.5" style={{ color: PRIORITY_META[p].color }} />
                  </button>
                ))}
              </div>
              {note && boards.length > 0 && (
                <>
                  <div className="px-2.5 pt-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">Move to board</div>
                  <div className="max-h-44 overflow-y-auto">
                    {boards.map((b) => (
                      <MenuItem
                        key={b.id}
                        onClick={() => {
                          onMoveToBoard(note, b);
                          close();
                        }}
                      >
                        <FolderInput className="h-4 w-4 text-fg-subtle" />
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                        <span className="truncate" dir="auto">{b.name}</span>
                      </MenuItem>
                    ))}
                  </div>
                </>
              )}
              <div className="my-1 h-px bg-border" />
              <MenuItem
                className="text-danger hover:bg-danger-soft"
                onClick={() => {
                  onDelete(item);
                  close();
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
    </div>
  );
}
