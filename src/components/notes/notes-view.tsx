"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Pin,
  Sparkles,
  Trash2,
  Archive,
  Mic,
  ArrowUpRight,
  Loader2,
  NotebookPen,
  GripVertical,
  ChevronDown,
  MoreHorizontal,
  Inbox,
  X,
  Check,
  Pencil,
  Plus,
  CalendarClock,
  CalendarRange,
  CornerDownLeft,
  Maximize2,
  Minimize2,
  Ticket,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown, toggleTask } from "@/components/ui/markdown";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { ProcessSheet } from "./process-sheet";
import { useDictation } from "./use-dictation";
import { api } from "@/lib/client-api";
import { enqueueOfflineMutation, getOfflineMutations, setOfflineMutations } from "@/lib/offline-queue";
import { ticketHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import {
  buildSchedule,
  coarseBucket,
  compareSectionNotes,
  defaultCollapsedKeys,
  dueFromDay,
  dayFromBucket,
  isSectionVisibleNote,
  noteSectionKey,
  reflectionSectionKey,
  type Schedule,
  type NoteSection,
} from "@/lib/notes-schedule";
import type { NoteT, AgentLite, BoardLite, TicketReflectionT, RecentActionT } from "@/lib/types";

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Notes that occupy a time-section: active inbox/queued notes, plus notes done
 * *today* (which stay sunk to the bottom of their section for the day). Notes
 * done on an earlier day have been swept out by next-day archival.
 */
function inPlay(n: NoteT, todayYmd: string): boolean {
  return isSectionVisibleNote(n, todayYmd);
}

/** Group notes into ordered id-lists keyed by section, ordered by position. */
function groupNotes(notes: NoteT[], schedule: Schedule): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const s of schedule.sections) map[s.key] = [];
  const active = notes
    .filter((n) => inPlay(n, schedule.todayYmd))
    .slice()
    .sort(compareSectionNotes);
  for (const n of active) {
    const key = noteSectionKey(schedule, n);
    (map[key] ??= []).push(n.id);
  }
  return map;
}

/** Bucket due-ticket reflections into section keys, sorted: open before done, then by due date. */
function groupReflections(
  reflections: TicketReflectionT[],
  schedule: Schedule,
): Record<string, TicketReflectionT[]> {
  const map: Record<string, TicketReflectionT[]> = {};
  for (const r of reflections) {
    const key = reflectionSectionKey(schedule, r.dueDate);
    (map[key] ??= []).push(r);
  }
  for (const key of Object.keys(map)) {
    map[key].sort(
      (a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || +new Date(a.dueDate) - +new Date(b.dueDate),
    );
  }
  return map;
}

const QUEUE_KEY = "kanbai-note-queue";
type QueueItem = { tempId: string; body: string; scheduledDay: string | null; bucket?: string; priority?: string };
function readQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeQueue(q: QueueItem[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* noop */
  }
}
/**
 * True when api() failed before the server answered: fetch rejects with a
 * TypeError on network failure, or the browser already knows it's offline.
 * Anything api() itself throws (a plain Error) means the server responded with
 * an HTTP error — a definitive rejection that must not be queued for replay.
 */
function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return e instanceof TypeError;
}
function makeTempNote(body: string, scheduledDay: string | null): NoteT {
  const now = new Date().toISOString();
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    body,
    status: "inbox",
    pinned: false,
    bucket: coarseBucket(scheduledDay),
    scheduledDay,
    doneOn: null,
    position: 9999,
    priority: "none",
    suggestedDueDate: dueFromDay(scheduledDay),
    sortContext: null,
    assignedAgent: null,
    attachments: [],
    ticket: null,
    queuedAt: null,
    createdAt: now,
    updatedAt: now,
    pending: true,
  };
}

// ── auto-growing textarea (shared) ───────────────────────────────────────────

function AutoGrow({
  value,
  onChange,
  onBlur,
  onSubmit,
  placeholder,
  className,
  autoFocus,
  dir,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  dir?: "ltr" | "rtl" | "auto";
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  React.useEffect(resize, [value, resize]);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastW = el.clientWidth;
    resize();
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w !== lastW) {
        lastW = w;
        resize();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);
  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (onSubmit && e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
      rows={1}
      dir={dir}
      placeholder={placeholder}
      className={cn("w-full resize-none bg-transparent outline-none placeholder:text-fg-subtle", className)}
    />
  );
}

// ── main view ────────────────────────────────────────────────────────────────

export function NotesView({
  notes: initial,
  agents,
  boards,
  reflections = [],
  recentActions = [],
  weekStartsOn,
  handedness = "right",
  dictationLanguage = "auto",
}: {
  notes: NoteT[];
  agents: AgentLite[];
  boards: BoardLite[];
  reflections?: TicketReflectionT[];
  recentActions?: RecentActionT[];
  weekStartsOn: number;
  handedness?: "right" | "left";
  dictationLanguage?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  const [notesById, setNotesById] = React.useState<Record<string, NoteT>>(() => {
    if (initial.length > 0 || typeof localStorage === "undefined") {
      return Object.fromEntries(initial.map((n) => [n.id, n]));
    }
    try {
      const cached = JSON.parse(localStorage.getItem("kanbai-notes-cache") || "[]") as NoteT[];
      return Object.fromEntries(cached.map((n) => [n.id, n]));
    } catch {
      return {};
    }
  });
  const notesRef = React.useRef(notesById);
  notesRef.current = notesById;
  const upsertNote = (n: NoteT) => setNotesById((m) => ({ ...m, [n.id]: n }));
  React.useEffect(() => {
    try {
      localStorage.setItem("kanbai-notes-cache", JSON.stringify(Object.values(notesById).filter((n) => !n.id.startsWith("tmp-"))));
    } catch {
      /* noop */
    }
  }, [notesById]);

  // Rematerialize offline-captured notes still waiting in the local queue as
  // pending rows on mount — otherwise a reload while offline makes them vanish
  // (they're excluded from the notes cache) until the next successful flush.
  React.useEffect(() => {
    const queued = readQueue();
    if (queued.length === 0) return;
    setNotesById((m) => {
      const next = { ...m };
      for (const item of queued) {
        if (next[item.tempId]) continue;
        const day = item.scheduledDay !== undefined ? item.scheduledDay : dayFromBucket(item.bucket);
        const n = makeTempNote(item.body, day ?? null);
        n.id = item.tempId; // keep the stored id so flush's replaceTemp finds it
        if (item.priority) n.priority = item.priority;
        next[item.tempId] = n;
      }
      return next;
    });
  }, []);

  // Notes with an in-flight optimistic mutation (a local edit whose PATCH hasn't
  // returned) and notes just deleted — both must survive a background poll/refresh
  // that may read the DB before our write commits, or it would revert/resurrect them.
  const busyIds = React.useRef<Set<string>>(new Set());
  const deletedIds = React.useRef<Set<string>>(new Set());

  // Re-sync from the server whenever fresh props arrive (e.g. after a poll/refresh
  // an agent has filed a queued note → status "sorted"). Keep optimistic notes the
  // server hasn't seen yet (offline-pending / temp ids / in-flight edits) and don't
  // resurrect just-deleted ones; let the server prune everything else.
  React.useEffect(() => {
    setNotesById((prev) => {
      const next: Record<string, NoteT> = {};
      for (const [id, n] of Object.entries(prev)) {
        if (n.pending || id.startsWith("tmp-") || busyIds.current.has(id)) next[id] = n;
      }
      for (const n of initial) {
        if (deletedIds.current.has(n.id)) continue;
        if (!next[n.id]) next[n.id] = n;
      }
      return next;
    });
  }, [initial]);

  // Poll while any note is "queued" so an agent's fulfillment surfaces without a
  // manual reload. Stops as soon as nothing is queued; pauses on a hidden tab.
  const hasQueued = React.useMemo(
    () => Object.values(notesById).some((n) => n.status === "queued"),
    [notesById],
  );
  React.useEffect(() => {
    if (!hasQueued) return;
    const iv = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) router.refresh();
    }, 4000);
    return () => clearInterval(iv);
  }, [hasQueued, router]);

  // The note id currently flashing a hand-off animation as it's sent to an agent.
  const [ingestingId, setIngestingId] = React.useState<string | null>(null);

  // `now` recomputes the time-sections; it ticks at local midnight and on focus
  // so buckets roll forward (tomorrow → today, etc.) without a reload.
  const [now, setNow] = React.useState<Date>(() => new Date());
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function arm() {
      const n = new Date();
      const nextMidnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        setNow(new Date());
        router.refresh();
        arm();
      }, nextMidnight.getTime() - n.getTime());
    }
    arm();
    const onFocus = () => setNow(new Date());
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  const schedule = React.useMemo(() => buildSchedule(now, weekStartsOn), [now, weekStartsOn]);
  const daySections = React.useMemo(() => schedule.sections.filter((s) => s.kind === "day"), [schedule]);
  const sectionByKind = (k: NoteSection["kind"]) => schedule.sections.find((s) => s.kind === k)!;
  const baseContainers = React.useMemo(
    () => groupNotes(Object.values(notesById), schedule),
    [notesById, schedule],
  );
  // Read-through reflections of due board tickets, bucketed by section. These are
  // not notes and never enter the drag/sortable lists — they render beneath them.
  const reflectionsBySection = React.useMemo(
    () => groupReflections(reflections, schedule),
    [reflections, schedule],
  );

  // Drag override: a transient container map active only while dragging.
  const [dragMap, setDragMap] = React.useState<Record<string, string[]> | null>(null);
  const dragMapRef = React.useRef(dragMap);
  const setDM = (m: Record<string, string[]> | null) => {
    dragMapRef.current = m;
    setDragMap(m);
  };
  const containers = dragMap ?? baseContainers;

  const [draft, setDraft] = React.useState("");
  // Quick captures land in "Unsorted" by default — decide when later by dragging.
  const [draftDay, setDraftDay] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (draftDay !== null && draftDay < schedule.todayYmd) setDraftDay(schedule.todayYmd);
  }, [schedule.todayYmd, draftDay]);

  const [expanded, setExpanded] = React.useState(false);
  const dictateBase = React.useRef("");
  const dictation = useDictation((text) => {
    setDraft((dictateBase.current ? dictateBase.current + " " : "") + text);
  }, dictationLanguage);
  // Server-side transcription in flight: recording has stopped but the text hasn't
  // landed in the draft yet. Status strings come from use-dictation (stopServer /
  // transcribe); a finished run parks at progress 100, an error replaces the status.
  const transcribing =
    dictation.progress < 100 &&
    (dictation.status === "Transcribing…" ||
      dictation.status === "Uploading audio…" ||
      dictation.status.startsWith("Preparing"));
  const [sortNote, setSortNote] = React.useState<NoteT | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  // Fresh load: only Today is open. Every other schedule section (Unsorted, the
  // "This week" group, and all future buckets) starts collapsed until the user
  // opens it — or adds a note to it — within the session.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() =>
    defaultCollapsedKeys(buildSchedule(new Date(), weekStartsOn)),
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [recentlyDone, setRecentlyDone] = React.useState<Set<string>>(() => new Set());
  // The note id that just settled into the bottom of its section after the
  // done-delay elapsed — gets a one-shot landing animation in place.
  const [doneLandingId, setDoneLandingId] = React.useState<string | null>(null);
  const doneTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  React.useEffect(
    () => () => {
      for (const t of doneTimers.current.values()) clearTimeout(t);
      doneTimers.current.clear();
    },
    [],
  );

  const focusId = params.get("focus");
  const composeFocus = params.get("compose") === "1";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── capture ────────────────────────────────────────────────────────────────
  async function addNote(body: string, scheduledDay: string | null, priority = "none") {
    const text = body.trim();
    if (!text) return;
    const optimistic = makeTempNote(text, scheduledDay);
    optimistic.priority = priority;
    upsertNote(optimistic);
    const key = schedule.classify(scheduledDay);
    setCollapsed((s) => {
      const next = new Set(s);
      next.delete(key);
      if (key.startsWith("day:")) next.delete("this_week");
      return next;
    });
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
      const { note } = await api<{ note: NoteT }>("/api/notes", { body: { body: text, scheduledDay, priority } });
      replaceTemp(optimistic.id, note);
      router.refresh();
    } catch (e) {
      if (isNetworkError(e)) {
        writeQueue([...readQueue(), { tempId: optimistic.id, body: text, scheduledDay, priority }]);
        toast({ title: "Saved offline", description: "It'll sync when you're back online.", variant: "info" });
      } else {
        // The server actively rejected the note — queueing it would poison the
        // offline queue. Drop the optimistic row and put the text back in the composer.
        setNotesById((m) => {
          const next = { ...m };
          delete next[optimistic.id];
          return next;
        });
        setDraft((d) => (d.trim() ? `${d}\n${text}` : text));
        toast({ title: "Couldn't save note", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    }
  }

  function replaceTemp(tempId: string, note: NoteT) {
    setNotesById((m) => {
      const next = { ...m };
      delete next[tempId];
      next[note.id] = note;
      return next;
    });
  }

  function submitDraft() {
    if (transcribing) return; // dictated words are still in flight; submitting now would drop them
    if (!draft.trim()) return;
    dictation.stop();
    addNote(draft, draftDay);
    setDraft("");
    setExpanded(false);
  }

  // ── offline replay ───────────────────────────────────────────────────────────
  const flushingRef = React.useRef(false);
  const flush = React.useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (flushingRef.current || (readQueue().length === 0 && getOfflineMutations().length === 0)) return; // single-flight: no concurrent replays
    flushingRef.current = true;
    (async () => {
      let dropped = 0;
      try {
        for (const item of readQueue()) {
          try {
            const scheduledDay =
              item.scheduledDay !== undefined ? item.scheduledDay : dayFromBucket(item.bucket);
            const { note } = await api<{ note: NoteT }>("/api/notes", {
              body: { body: item.body, scheduledDay, priority: item.priority },
            });
            replaceTemp(item.tempId, note);
            writeQueue(readQueue().filter((x) => x.tempId !== item.tempId));
          } catch (e) {
            if (isNetworkError(e)) break; // stay queued; retry next reconnect
            // Definitive server rejection: drop this item so it can't block the
            // queue forever, and keep flushing the rest.
            writeQueue(readQueue().filter((x) => x.tempId !== item.tempId));
            setNotesById((m) => {
              const next = { ...m };
              delete next[item.tempId];
              return next;
            });
            dropped++;
          }
        }
        for (const item of getOfflineMutations()) {
          try {
            if (item.kind === "note.patch") {
              const { note } = await api<{ note: NoteT }>(`/api/notes/${item.id}`, { method: "PATCH", body: item.body });
              upsertNote(note);
            }
            setOfflineMutations(getOfflineMutations().filter((x) => x.enqueuedAt !== item.enqueuedAt));
          } catch (e) {
            if (isNetworkError(e)) break; // stay queued; retry next reconnect
            // Definitive server rejection: drop the mutation and keep flushing.
            setOfflineMutations(getOfflineMutations().filter((x) => x.enqueuedAt !== item.enqueuedAt));
            dropped++;
          }
        }
      } finally {
        flushingRef.current = false;
      }
      if (dropped > 0) {
        toast({
          title: `Couldn't sync ${dropped} offline ${dropped === 1 ? "change" : "changes"}`,
          description: "Rejected by the server and removed from the queue.",
          variant: "error",
        });
      }
      router.refresh();
    })();
  }, [router, toast]);

  React.useEffect(() => {
    const foregroundSync = () => {
      flush();
      if (typeof navigator === "undefined" || navigator.onLine !== false) router.refresh();
    };
    foregroundSync();
    window.addEventListener("online", foregroundSync);
    window.addEventListener("focus", foregroundSync);
    document.addEventListener("visibilitychange", foregroundSync);
    return () => {
      window.removeEventListener("online", foregroundSync);
      window.removeEventListener("focus", foregroundSync);
      document.removeEventListener("visibilitychange", foregroundSync);
    };
  }, [flush, router]);

  // ── mutations ────────────────────────────────────────────────────────────────
  async function patchNote(id: string, partial: Record<string, unknown>, refresh = false) {
    const cur = notesRef.current[id];
    if (cur) upsertNote({ ...cur, ...(partial as Partial<NoteT>) });
    busyIds.current.add(id);
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}`, { method: "PATCH", body: partial });
      upsertNote(note);
      if (refresh) router.refresh();
    } catch (e) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueueOfflineMutation({ kind: "note.patch", id, body: partial });
        toast({ title: "Saved offline", description: "It'll sync when you're back online.", variant: "info" });
      } else {
        toast({ title: "Something went wrong", description: e instanceof Error ? e.message : undefined, variant: "error" });
        router.refresh();
      }
    } finally {
      busyIds.current.delete(id);
    }
  }

  function saveBody(id: string, body: string) {
    const cur = notesRef.current[id];
    if (!cur || body === cur.body || !body.trim()) return;
    patchNote(id, { body });
  }

  function setPriority(id: string, priority: string) {
    patchNote(id, { priority });
  }

  function clearDoneAnimation(id: string) {
    setRecentlyDone((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    const timer = doneTimers.current.get(id);
    if (timer) clearTimeout(timer);
    doneTimers.current.delete(id);
  }

  function toggleDone(note: NoteT) {
    // A note counts as "done" if it's persisted done OR mid-completion (the delayed
    // landing timer is still pending). Either way a second click must UNDO it —
    // otherwise clicking an already-struck note during the ~1.25s settle window
    // just re-armed completion instead of reverting.
    const pending = doneTimers.current.has(note.id);
    if (note.doneOn != null || pending) {
      clearDoneAnimation(note.id);
      setDoneLandingId((id) => (id === note.id ? null : id));
      setRecentlyDone((s) => {
        if (!s.has(note.id)) return s;
        const next = new Set(s);
        next.delete(note.id);
        return next;
      });
      // Always clear on the server too: works whether completion is still pending
      // (harmless no-op) or already landed (actually un-dones it).
      patchNote(note.id, { doneOn: null });
      return;
    }

    const existing = doneTimers.current.get(note.id);
    if (existing) clearTimeout(existing);
    setRecentlyDone((s) => new Set(s).add(note.id));
    toast({
      title: "Marked done",
      description: "Settling at the bottom of this section…",
      variant: "success",
      actionLabel: "Undo",
      onAction: () => {
        clearDoneAnimation(note.id);
        setDoneLandingId((id) => (id === note.id ? null : id));
        // Undo must work both before and after the delayed completion fires. If the
        // timer is still pending this is a harmless optimistic no-op; if completion
        // already landed it clears the done state on the server and locally.
        patchNote(note.id, { doneOn: null });
      },
    });
    const timer = setTimeout(() => {
      doneTimers.current.delete(note.id);
      setRecentlyDone((s) => {
        const next = new Set(s);
        next.delete(note.id);
        return next;
      });
      // Mark done: the note sinks to the bottom of its own section (Today done at
      // the bottom of Today, future done within its future section) and plays a
      // landing animation there. No global Done bucket.
      setDoneLandingId(note.id);
      patchNote(note.id, { doneOn: schedule.todayYmd });
    }, 1250);
    doneTimers.current.set(note.id, timer);
  }

  function archive(id: string) {
    const cur = notesRef.current[id];
    if (cur) upsertNote({ ...cur, status: "archived" });
    busyIds.current.add(id);
    void api(`/api/notes/${id}`, { method: "PATCH", body: { status: "archived" } })
      .catch(() => router.refresh())
      .finally(() => busyIds.current.delete(id));
    toast({
      title: "Note archived",
      actionLabel: "Undo",
      onAction: () => restore(id),
    });
  }

  function restore(id: string) {
    const cur = notesRef.current[id];
    if (!cur) return;
    upsertNote({ ...cur, status: "inbox" });
    busyIds.current.add(id);
    void api(`/api/notes/${id}`, { method: "PATCH", body: { status: "inbox" } })
      .catch(() => router.refresh())
      .finally(() => busyIds.current.delete(id));
  }

  async function del(id: string) {
    const cur = notesRef.current[id];
    setNotesById((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    deletedIds.current.add(id); // tombstone so a poll refresh can't resurrect it
    try {
      await api(`/api/notes/${id}`, { method: "DELETE" });
      if (cur) {
        toast({
          title: "Note deleted",
          actionLabel: "Undo",
          onAction: () => undoDelete(cur),
        });
      }
    } catch {
      router.refresh();
    } finally {
      setTimeout(() => deletedIds.current.delete(id), 8000);
    }
  }

  /** Un-trash a just-deleted note (delete is soft; the server keeps it in Trash 30 days). */
  function undoDelete(note: NoteT) {
    deletedIds.current.delete(note.id);
    upsertNote(note);
    busyIds.current.add(note.id);
    void api("/api/trash", { method: "POST", body: { action: "restore", type: "note", id: note.id } })
      .catch(() => toast({ title: "Couldn't restore note", variant: "error" }))
      .finally(() => {
        busyIds.current.delete(note.id);
        router.refresh();
      });
  }

  /** Toggle the per-line "mark for ingestion" flag. The line stays in place. */
  async function toggleIngest(id: string, ingest: boolean) {
    const cur = notesRef.current[id];
    if (cur) upsertNote({ ...cur, status: ingest ? "queued" : "inbox" });
    if (ingest) {
      setIngestingId(id);
      setTimeout(() => setIngestingId((c) => (c === id ? null : c)), 900);
    }
    busyIds.current.add(id);
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}/ingest`, { body: { ingest } });
      upsertNote(note);
      if (ingest) {
        toast({
          title: note.assignedAgent ? `Marked for ${note.assignedAgent.name}` : "Marked for ingestion",
          description: note.assignedAgent
            ? "It'll be filed into the right board as a ticket."
            : "Connect an agent and it'll be picked up.",
          variant: "info",
        });
      }
      router.refresh();
    } catch (e) {
      if (cur) upsertNote(cur);
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      busyIds.current.delete(id);
    }
  }

  function toggleCheckbox(note: NoteT, index: number) {
    saveBody(note.id, toggleTask(note.body, index));
  }

  // ── drag & drop across sections ──────────────────────────────────────────────
  function keyOf(map: Record<string, string[]>, id: string): string | null {
    if (id in map) return id;
    return Object.keys(map).find((k) => map[k].includes(id)) ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    const snapshot = Object.fromEntries(Object.entries(baseContainers).map(([k, v]) => [k, [...v]]));
    setDM(snapshot);
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const map = dragMapRef.current;
    if (!map) return;
    const aId = String(active.id);
    const overId = String(over.id);
    const activeContainer = keyOf(map, aId);
    const overContainer = overId in map ? overId : keyOf(map, overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    const activeItems = map[activeContainer];
    const overItems = map[overContainer];
    const overIndex = overId in map ? overItems.length : Math.max(0, overItems.indexOf(overId));
    setDM({
      ...map,
      [activeContainer]: activeItems.filter((id) => id !== aId),
      [overContainer]: [...overItems.slice(0, overIndex), aId, ...overItems.slice(overIndex)],
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    const map = dragMapRef.current;
    if (!map || !over) {
      setDM(null);
      return;
    }
    const aId = String(active.id);
    const overId = String(over.id);
    const activeContainer = keyOf(map, aId);
    if (!activeContainer) {
      setDM(null);
      return;
    }
    const overContainer = overId in map ? overId : keyOf(map, overId);

    let finalMap = map;
    if (overContainer && activeContainer === overContainer) {
      const items = map[activeContainer];
      const oldIndex = items.indexOf(aId);
      const newIndex = overId in map ? items.length - 1 : items.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalMap = { ...map, [activeContainer]: arrayMove(items, oldIndex, newIndex) };
      }
    }

    const finalKey = keyOf(finalMap, aId);
    if (!finalKey) {
      setDM(null);
      return;
    }
    const section = schedule.sections.find((s) => s.key === finalKey);
    const day = section ? section.day : null;
    const ids = finalMap[finalKey];
    // The server splices within the exact scheduledDay, but a section can also
    // hold strays (overdue notes in Today, rolled-over notes in Unsorted) — so
    // the persisted position must be indexed only among ids sharing the target day.
    const dayIds = ids.filter((id) => id === aId || (notesRef.current[id]?.scheduledDay ?? null) === day);
    const index = dayIds.indexOf(aId);

    // Bake the new order + schedule into local state so it doesn't snap back.
    setNotesById((m) => {
      const next = { ...m };
      ids.forEach((id, i) => {
        const n = next[id];
        if (!n) return;
        next[id] =
          id === aId
            ? { ...n, position: i, scheduledDay: day, bucket: coarseBucket(day), suggestedDueDate: dueFromDay(day) }
            : { ...n, position: i };
      });
      return next;
    });
    setDM(null);
    void persistMove(aId, day, index);
  }

  async function persistMove(id: string, scheduledDay: string | null, position: number) {
    if (id.startsWith("tmp-")) return; // offline-pending note; will sync first
    busyIds.current.add(id);
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}/move`, { body: { scheduledDay, position } });
      upsertNote(note);
    } catch {
      toast({ title: "Couldn't move note", variant: "error" });
      router.refresh();
    } finally {
      busyIds.current.delete(id);
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const q = "";
  const allNotes = Object.values(notesById);
  const sorted = allNotes
    .filter((n) => n.status === "sorted" && (!q || n.body.toLowerCase().includes(q)))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const recentSorted = sorted.filter((n) => {
    const t = +new Date(n.updatedAt || n.createdAt);
    return Number.isFinite(t) && +now - t < 48 * 60 * 60 * 1000;
  });
  // Notes done on an earlier day are hidden from every schedule section by the
  // next-day sweep, so the archive list is their only remaining surface.
  const archived = allNotes.filter(
    (n) => n.status === "archived" || (n.doneOn != null && n.doneOn < schedule.todayYmd),
  );
  // Completed notes are no longer pooled into a global Done bucket — they live at
  // the bottom of their own schedule section (see compareSectionNotes) until
  // next-day archival sweeps them out. So totalActive already counts done-today
  // notes through `containers`.
  const totalActive = schedule.sections.reduce(
    (sum, s) => sum + (containers[s.key]?.length ?? 0) + (reflectionsBySection[s.key]?.length ?? 0),
    0,
  );

  const dragging = !!activeId;
  function isOpen(key: string, count: number) {
    if (dragging) return true; // every section becomes a drop target mid-drag
    if (q) return count > 0;
    return !collapsed.has(key);
  }
  function toggleSection(key: string) {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const matchId = (id: string) => {
    if (!q) return true;
    return (notesById[id]?.body ?? "").toLowerCase().includes(q);
  };
  const refsFor = (key: string): TicketReflectionT[] => {
    const list = reflectionsBySection[key] ?? [];
    if (!q) return list;
    return list.filter((r) => r.title.toLowerCase().includes(q) || r.boardName.toLowerCase().includes(q));
  };
  // A section's total item count includes its reflected tickets, so day slots
  // that hold only a due ticket still render and stay open.
  const sectionCount = (key: string) =>
    (containers[key]?.length ?? 0) + (reflectionsBySection[key]?.length ?? 0);

  const weekCount = daySections.reduce(
    (sum, s) => sum + (containers[s.key]?.filter(matchId).length ?? 0) + refsFor(s.key).length,
    0,
  );
  const weekOpen = isOpen("this_week", weekCount);
  const activeNote = activeId ? notesById[activeId] : null;

  React.useEffect(() => {
    if (!dragging) return;
    let pointerY: number | null = null;
    let frame = 0;
    const onMove = (e: PointerEvent | TouchEvent) => {
      pointerY = "touches" in e ? e.touches[0]?.clientY ?? null : e.clientY;
    };
    const tick = () => {
      if (pointerY != null) {
        const margin = 88;
        const max = window.innerHeight;
        if (pointerY < margin) window.scrollBy({ top: -14, behavior: "auto" });
        else if (pointerY > max - margin) window.scrollBy({ top: 14, behavior: "auto" });
      }
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, [dragging]);

  const rowProps = {
    notesById,
    focusId,
    handedness,
    ingestingId,
    recentlyDone,
    doneLandingId,
    dragDisabled: !!q,
    onSaveBody: saveBody,
    onToggleCheckbox: toggleCheckbox,
    onToggleDone: toggleDone,
    onSetPriority: setPriority,
    onPin: (id: string, pinned: boolean) => patchNote(id, { pinned }),
    onArchive: archive,
    onDelete: del,
    onIngest: toggleIngest,
    onFile: (n: NoteT) => setSortNote(n),
  };

  const unsorted = sectionByKind("general");
  const today = sectionByKind("today");
  const nextWeek = sectionByKind("next_week");
  const laterThisMonth = sectionByKind("later_this_month");
  const nextMonth = sectionByKind("next_month");
  const longTerm = sectionByKind("long_term");

  function block(section: NoteSection, extra?: { card?: boolean; variant?: "unsorted" | "today" | "plain" | "quiet"; icon?: React.ComponentType<{ className?: string }> }) {
    const ids = (containers[section.key] ?? []).filter(matchId);
    const refs = refsFor(section.key);
    return (
      <NoteSectionBlock
        section={section}
        open={isOpen(section.key, ids.length + refs.length)}
        count={sectionCount(section.key)}
        ids={ids}
        reflections={refs}
        boards={boards}
        dragging={dragging}
        onToggle={() => toggleSection(section.key)}
        onAdd={(text) => addNote(text, section.day)}
        card={extra?.card}
        variant={extra?.variant}
        icon={extra?.icon}
        {...rowProps}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Notes</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Capture fast into Unsorted, then drag each line to the day it matters — or tick it off.
        </p>
      </header>

      {/* Composer */}
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-card transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <AutoGrow
          value={draft}
          onChange={setDraft}
          onSubmit={expanded ? undefined : submitDraft}
          autoFocus={composeFocus}
          dir="auto"
          placeholder={expanded ? "Write it all out…  (Shift+Enter for a new line)" : "Jot something down…  Try - [ ] a checklist"}
          className={cn("px-1 text-[0.95rem] leading-relaxed min-h-6", expanded && "min-h-40")}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {dictation.supported && (
              <button
                onClick={() => {
                  if (!dictation.listening) dictateBase.current = draft.trim();
                  dictation.toggle();
                }}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  dictation.listening ? "animate-pulse-soft bg-danger text-white" : "bg-surface-2 text-fg-muted hover:text-fg",
                )}
              >
                <Mic className="h-3.5 w-3.5" />
                {dictation.listening ? "Recording… tap to stop" : "Dictate"}
              </button>
            )}
            <DayChip value={draftDay} schedule={schedule} onChange={setDraftDay} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? "Shrink" : "Expand for a longer note"}
              aria-label={expanded ? "Shrink composer" : "Expand composer"}
              className="inline-flex items-center justify-center rounded-lg bg-primary-soft px-2 py-1.5 text-primary transition-colors hover:bg-primary/20 cursor-pointer"
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={submitDraft}
              disabled={transcribing}
              title={transcribing ? "Transcribing…" : undefined}
              className={cn(
                "rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-hover cursor-pointer transition-all",
                draft.trim() || transcribing ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95",
                transcribing && "cursor-not-allowed opacity-60",
              )}
            >
              Add Note
            </button>
          </div>
        </div>
        {dictation.status && (
          <div className="mt-2 text-xs text-fg-subtle">
            {dictation.status}
            {dictation.progress > 0 && dictation.progress < 100 && (
              <span className="ml-2 inline-block h-1.5 w-24 overflow-hidden rounded-full bg-surface-2 align-middle">
                <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${dictation.progress}%` }} />
              </span>
            )}
          </div>
        )}
      </div>

      <DndContext
        id="kanbai-notes"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {/* Unsorted — quick-capture catch-all, styled apart */}
        <div className="mt-5">{block(unsorted, { card: true, variant: "unsorted", icon: Inbox })}</div>

        {/* Today — the focus */}
        <div className="mt-3">{block(today, { card: true, variant: "today" })}</div>

        {/* This week (remaining weekdays) + next week / next month */}
        <div className="mt-3 divide-y divide-border/60 rounded-2xl border border-border bg-surface/40">
          {daySections.length > 0 && (
            <div className="px-2 py-1.5">
              <button
                onClick={() => toggleSection("this_week")}
                className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2/60 cursor-pointer"
              >
                <ChevronDown className={cn("h-4 w-4 text-fg-subtle transition-transform", !weekOpen && "-rotate-90")} />
                <CalendarRange className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">This week</span>
                {weekCount > 0 && <span className="text-xs font-medium text-fg-subtle">{weekCount}</span>}
              </button>
              {weekOpen && (
                <div className="mt-1 space-y-0.5 border-l border-border/60 pl-2">
                  {daySections.map((s) => {
                    const ids = (containers[s.key] ?? []).filter(matchId);
                    return (
                      <NoteSectionBlock
                        key={s.key}
                        section={s}
                        sub
                        open
                        count={sectionCount(s.key)}
                        ids={ids}
                        reflections={refsFor(s.key)}
                        boards={boards}
                        dragging={dragging}
                        onToggle={() => {}}
                        onAdd={(text) => addNote(text, s.day)}
                        {...rowProps}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {block(nextWeek)}
          {block(laterThisMonth, { variant: "quiet" })}
          {block(nextMonth)}
          {block(longTerm, { variant: "quiet" })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeNote ? (
            <div className="rotate-1 rounded-xl border border-primary/40 bg-surface px-3 py-2 shadow-lg">
              <span className="line-clamp-2 text-sm">{activeNote.body}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {totalActive === 0 && sorted.length === 0 && archived.length === 0 && !q && (
        <EmptyState
          icon={NotebookPen}
          title="Nothing captured yet"
          description="Jot a line above — it lands in Unsorted. Then drag it to a day, tick it off, or mark it for an agent."
          className="mt-6"
        />
      )}
      {totalActive === 0 && q && (
        <p className="px-1 py-6 text-center text-sm text-fg-subtle">No notes match.</p>
      )}

      {/* Recent actions (notes filed into tickets) */}
      {recentActions.length > 0 && <RecentActionsSection actions={recentActions} />}

      {/* Archived */}
      {archived.length > 0 && (
        <section className="mt-7">
          <button
            onClick={() => setShowArchived((s) => !s)}
            className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg-muted cursor-pointer"
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map((n) => (
                <div key={n.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-sm text-fg-subtle">{n.body}</p>
                  <button
                    onClick={() => restore(n.id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg cursor-pointer"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => del(n.id)}
                    className="shrink-0 text-fg-subtle hover:text-danger cursor-pointer"
                    aria-label="Delete permanently"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {sortNote && (
        <ProcessSheet
          note={sortNote}
          boards={boards}
          agents={agents}
          onClose={() => setSortNote(null)}
          onDone={(updated) => {
            upsertNote(updated);
            setSortNote(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── recent actions section ────────────────────────────────────────────────────

function RecentActionsSection({ actions }: { actions: RecentActionT[] }) {
  const [open, setOpen] = React.useState(false);
  const visible = open ? actions : [];
  return (
    <section className="mt-7">
      <button
        onClick={() => setOpen((s) => !s)}
        className="group flex w-full items-center gap-2 px-1 text-left text-xs font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg-muted cursor-pointer"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        <Sparkles className="h-3.5 w-3.5" />
        Recent Actions
        <span className="text-fg-subtle/70">30 days · {actions.length}</span>
      </button>
      {open && (
        <div className="mt-2 divide-y divide-border/50 px-1">
          {visible.slice(0, 30).map((a) => (
            <div key={a.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
              <div className="min-w-0 text-fg-muted">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-fg-subtle">{a.actorName}</div>
                <div className="text-[0.6875rem] capitalize text-fg-subtle/65">{a.actorType}</div>
              </div>
              <div className="min-w-0">
                <p className="overflow-hidden text-ellipsis whitespace-nowrap text-fg-muted">Filed “{a.noteBody}”</p>
                <time className="text-[0.6875rem] text-fg-subtle/65">
                  {new Date(a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </time>
              </div>
              {a.resourceHref && (
                <Link
                  href={a.resourceHref}
                  className="col-start-2 inline-flex w-fit items-center gap-1 rounded-md bg-surface px-2 py-1 text-[0.6875rem] font-medium text-primary hover:bg-primary-soft sm:col-start-auto"
                >
                  {a.resourceLabel ?? "Ticket"}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── section block (a droppable list of note rows + inline add) ────────────────

type RowHandlers = {
  notesById: Record<string, NoteT>;
  focusId: string | null;
  handedness: "right" | "left";
  ingestingId: string | null;
  recentlyDone: Set<string>;
  doneLandingId: string | null;
  dragDisabled?: boolean;
  onSaveBody: (id: string, body: string) => void;
  onToggleCheckbox: (note: NoteT, index: number) => void;
  onToggleDone: (note: NoteT) => void;
  onSetPriority: (id: string, p: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onIngest: (id: string, ingest: boolean) => void;
  onFile: (note: NoteT) => void;
};

function NoteSectionBlock({
  section,
  open,
  count,
  ids,
  reflections = [],
  boards,
  sub,
  card,
  variant = "plain",
  icon: Icon,
  dragging,
  onToggle,
  onAdd,
  notesById,
  focusId,
  handedness,
  ingestingId,
  recentlyDone,
  doneLandingId,
  dragDisabled,
  onSaveBody,
  onToggleCheckbox,
  onToggleDone,
  onSetPriority,
  onPin,
  onArchive,
  onDelete,
  onIngest,
  onFile,
}: RowHandlers & {
  section: NoteSection;
  open: boolean;
  count: number;
  ids: string[];
  reflections?: TicketReflectionT[];
  boards: BoardLite[];
  sub?: boolean;
  card?: boolean;
  variant?: "unsorted" | "today" | "plain" | "quiet";
  icon?: React.ComponentType<{ className?: string }>;
  dragging?: boolean;
  onToggle: () => void;
  onAdd: (text: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: section.key });
  const [adding, setAdding] = React.useState(false);
  const [addText, setAddText] = React.useState("");

  function commitAdd() {
    if (addText.trim()) onAdd(addText);
    setAddText("");
  }

  const empty = ids.length === 0;
  // Empty day slots stay compact; a drop target only appears while dragging.
  const showDropZone = sub && empty && (dragging || isOver);

  const outer = card
    ? cn(
        "rounded-2xl p-2 transition-colors",
        variant === "today" && "border border-border bg-surface shadow-card",
        variant === "unsorted" && "border border-dashed border-border bg-primary-soft/15",
        variant === "plain" && "border border-border bg-surface/40",
        variant === "quiet" && "border border-border/70 bg-surface/25",
        isOver && "ring-2 ring-primary/40",
      )
    : cn(
        "transition-colors",
        sub ? "rounded-lg px-1 py-0.5" : "px-2 py-1.5",
        variant === "quiet" && "bg-transparent",
        isOver && "rounded-lg bg-primary-soft/30",
      );

  const addLine = (
    <AutoGrow
      value={addText}
      onChange={setAddText}
      autoFocus
      onSubmit={commitAdd}
      onBlur={() => {
        commitAdd();
        setAdding(false);
      }}
      placeholder={`Add to ${section.label}…`}
      className="text-[0.95rem] leading-relaxed"
    />
  );

  return (
    <div ref={setNodeRef} className={outer}>
      {sub ? (
        // compact day header with an inline add affordance
        <div className="flex items-center gap-2 px-1.5 py-0.5">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-fg-muted">{section.label}</span>
          {section.sublabel && <span className="text-[0.6875rem] text-fg-subtle">{section.sublabel}</span>}
          <span className="ml-auto flex items-center gap-1.5">
            {count > 0 && <span className="text-[0.6875rem] font-medium text-fg-subtle">{count}</span>}
            <button
              onClick={() => setAdding(true)}
              title={`Add to ${section.label}`}
              aria-label={`Add to ${section.label}`}
              className="grid h-5 w-5 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      ) : (
        <button
          onClick={onToggle}
          className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2/60 cursor-pointer"
        >
          <ChevronDown className={cn("h-4 w-4 text-fg-subtle transition-transform", !open && "-rotate-90")} />
          {Icon && <Icon className="h-3.5 w-3.5 text-fg-subtle" />}
          <span
            className={cn(
              "uppercase tracking-wider",
              variant === "today" ? "text-[0.8rem] font-bold text-fg" : "text-xs font-semibold text-fg-muted",
            )}
          >
            {section.label}
          </span>
          {section.sublabel && <span className="text-[0.6875rem] font-normal normal-case text-fg-subtle">{section.sublabel}</span>}
          {count > 0 && (
            <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-semibold", variant === "unsorted" ? "bg-primary-soft text-primary-soft-fg" : "text-fg-subtle")}>{count}</span>
          )}
        </button>
      )}

      {open && (
        <div className={cn(sub ? "pl-1" : "pb-1 pl-1.5")}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="mt-0.5">
              {ids.map((id) => {
                const n = notesById[id];
                if (!n) return null;
                return (
                  <NoteRow
                    key={id}
                    note={n}
                    highlight={focusId === id}
                    handedness={handedness}
                    handoff={ingestingId === id}
                    justDone={recentlyDone.has(id)}
                    landing={doneLandingId === id}
                    dragDisabled={dragDisabled}
                    onSaveBody={(body) => onSaveBody(id, body)}
                    onToggleCheckbox={(i) => onToggleCheckbox(n, i)}
                    onToggleDone={() => onToggleDone(n)}
                    onSetPriority={(p) => onSetPriority(id, p)}
                    onPin={() => onPin(id, !n.pinned)}
                    onArchive={() => onArchive(id)}
                    onDelete={() => onDelete(id)}
                    onIngest={(v) => onIngest(id, v)}
                    onFile={() => onFile(n)}
                  />
                );
              })}
            </div>
          </SortableContext>

          {reflections.length > 0 && (
            <div className="mt-1 space-y-1">
              {reflections.map((r) => (
                <ReflectionRow key={r.id} reflection={r} boards={boards} handedness={handedness} />
              ))}
            </div>
          )}

          {adding ? (
            <div className="flex items-start gap-2 rounded-lg px-2 py-1.5">
              <CornerDownLeft className="mt-1 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              {addLine}
            </div>
          ) : sub ? (
            // empty day: a dashed drop target that only appears while dragging
            showDropZone && (
              <div
                className={cn(
                  "mx-1 my-0.5 rounded-md border border-dashed px-2 py-1.5 text-center text-[0.6875rem] transition-colors",
                  isOver ? "border-primary bg-primary-soft/30 text-primary" : "border-border/60 text-fg-subtle",
                )}
              >
                Drop here
              </div>
            )
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-subtle hover:bg-surface-2/60 hover:text-fg-muted cursor-pointer"
            >
              <span className="grid h-4 w-4 place-items-center text-fg-subtle">+</span>
              Add a note
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── a reflected board ticket (read-through, not a note) ─────────────────────────

function ReflectionRow({
  reflection: r,
  boards,
  handedness,
}: {
  reflection: TicketReflectionT;
  boards: BoardLite[];
  handedness: "right" | "left";
}) {
  const dueDay = new Date(r.dueDate);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const overdue = startOfDay(dueDay) < startOfDay(now);
  const today = startOfDay(dueDay) === startOfDay(now);
  const statusLabel = overdue ? "Overdue" : today ? "Today" : null;
  const compact = "truncate";
  return (
    <Link
      href={ticketHref(r, boards, { from: "notes" })}
      title={`Open ${r.boardName} ticket${r.number != null ? ` #${r.number}` : ""} on its board`}
      className={cn(
        "group/reflection relative grid grid-cols-[minmax(6.5rem,34%)_1fr] overflow-hidden rounded-lg border bg-surface-2/20 transition-colors hover:border-border/80 hover:bg-surface-2/50",
        r.done ? "border-success/35" : "border-border",
        handedness === "left" && "ml-0",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col justify-center gap-0.5 border-r px-2 py-1.5 sm:px-2.5",
          r.done ? "border-success/30 bg-success-soft/35" : "border-border/60 bg-surface-3/50",
        )}
      >
        <span className={cn(compact, "text-[0.68rem] font-semibold uppercase tracking-wide text-fg-muted")}>{r.boardName}</span>
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.66rem] font-semibold uppercase tracking-wide",
            r.done
              ? "bg-success text-success-fg"
              : overdue
                ? "bg-danger/15 text-danger"
                : today
                  ? "bg-primary-soft text-primary"
                  : "bg-surface/60 text-fg-subtle",
          )}
        >
          {r.done ? "Done" : statusLabel ?? (r.number != null ? `#${r.number}` : "Ticket")}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <span
          className={cn(
            "min-w-0 flex-1 text-sm leading-snug line-clamp-2",
            r.done ? "text-fg-muted line-through decoration-fg-subtle/70 decoration-2" : "text-fg",
          )}
          dir="auto"
        >
          {r.title}
        </span>
        <Ticket className="h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover/reflection:text-fg-muted" aria-hidden />
      </div>
    </Link>
  );
}

// ── a single note line ─────────────────────────────────────────────────────────

function NoteRow({
  note,
  highlight,
  handedness,
  handoff,
  justDone,
  landing,
  dragDisabled,
  onSaveBody,
  onToggleCheckbox,
  onToggleDone,
  onSetPriority,
  onPin,
  onArchive,
  onDelete,
  onIngest,
  onFile,
}: {
  note: NoteT;
  highlight?: boolean;
  handedness: "right" | "left";
  handoff?: boolean;
  justDone?: boolean;
  landing?: boolean;
  dragDisabled?: boolean;
  onSaveBody: (body: string) => void;
  onToggleCheckbox: (index: number) => void;
  onToggleDone: () => void;
  onSetPriority: (p: string) => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onIngest: (ingest: boolean) => void;
  onFile: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled: dragDisabled,
  });
  const style = { transform: CSS.Translate.toString(transform), transition };
  const queued = note.status === "queued";
  const locked = queued || !!note.pending;
  const done = note.doneOn != null || justDone;
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(note.body);
  const [showFull, setShowFull] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement>(null);
  // Don't reset the textarea from props while actively editing (avoids a poll
  // refresh wiping in-progress typing). showFull intentionally persists across
  // body changes (e.g. ticking an in-body checkbox) — it resets on unmount since
  // each row is keyed by note id.
  React.useEffect(() => {
    if (!editing) setBody(note.body);
  }, [note.body, editing]);
  React.useEffect(() => {
    if (highlight && rowRef.current) rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  // Collapse a multi-line or long single-line body into a short preview with a
  // "Show more" toggle (full markdown, all newlines, on expand).
  const isLong = React.useMemo(() => {
    const b = note.body.trim();
    return b.includes("\n") || b.length > 140;
  }, [note.body]);

  const pmeta = PRIORITY_META[(note.priority as keyof typeof PRIORITY_META) ?? "none"] ?? PRIORITY_META.none;
  const hasPriority = note.priority !== "none";

  // Click almost anywhere on the line to toggle done — but not on links, the
  // in-body task checkboxes, or any control.
  function onBodyClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("a, button, input, label, textarea")) return;
    onToggleDone();
  }

  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      disabled={dragDisabled}
      className={cn(
        "mt-1.5 shrink-0 cursor-grab touch-none text-fg-subtle opacity-40 transition-opacity hover:text-fg-muted active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100",
        dragDisabled && "pointer-events-none !opacity-0",
      )}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  const moreMenu = !locked ? (
    <Menu
      align="start"
      trigger={
        <button
          title="More"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-subtle opacity-100 transition-opacity hover:bg-surface-2 hover:text-fg cursor-pointer md:opacity-0 md:group-hover:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {(close) => (
        <>
          <MenuItem
            onClick={() => {
              onToggleDone();
              close();
            }}
          >
            <Check className="h-4 w-4" /> {done ? "Mark not done" : "Mark done"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setEditing(true);
              close();
            }}
          >
            <Pencil className="h-4 w-4" /> Edit
          </MenuItem>
          <MenuItem
            onClick={() => {
              onIngest(true);
              close();
            }}
          >
            <Sparkles className="h-4 w-4" /> Send to an agent to file
          </MenuItem>
          <MenuItem
            onClick={() => {
              onFile();
              close();
            }}
          >
            <Inbox className="h-4 w-4" /> File into a ticket…
          </MenuItem>
          <MenuItem
            onClick={() => {
              onPin();
              close();
            }}
          >
            <Pin className={cn("h-4 w-4", note.pinned && "fill-current")} /> {note.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <div className="my-1 border-t border-border" />
          <div className="px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">
            Priority
          </div>
          <div className="flex items-center gap-1 px-2 pb-1.5">
            {PRIORITIES.map((p) => {
              const m = PRIORITY_META[p];
              const active = note.priority === p;
              return (
                <button
                  key={p}
                  title={m.label}
                  onClick={() => {
                    onSetPriority(p);
                    close();
                  }}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-md hover:bg-surface-2 cursor-pointer",
                    active && "bg-surface-2 ring-1 ring-border",
                  )}
                >
                  {p === "none" ? (
                    <span className="h-2.5 w-2.5 rounded-full border border-fg-subtle" />
                  ) : (
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                  )}
                </button>
              );
            })}
          </div>
          <div className="my-1 border-t border-border" />
          <MenuItem
            onClick={() => {
              onArchive();
              close();
            }}
          >
            <Archive className="h-4 w-4" /> Archive
          </MenuItem>
          <MenuItem
            className="text-danger hover:bg-danger/10"
            onClick={() => {
              onDelete();
              close();
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </MenuItem>
        </>
      )}
    </Menu>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-start gap-1.5 rounded-lg py-1.5 pr-1.5 transition-colors",
        handedness === "left" ? "pl-1.5" : "pl-2.5",
        !isDragging && "hover:bg-surface-2/50",
        isDragging && "opacity-40",
        queued && "bg-primary-soft/40",
        handoff && "animate-ai-handoff",
        justDone && "animate-done-slide",
        landing && "animate-slide-down-fade bg-success-soft/25",
        highlight && "ring-2 ring-primary",
      )}
    >
      <div ref={rowRef} className="absolute -top-px left-0 h-0 w-0" />

      {/* priority — a minimal colored bar on the left edge (no second circle) */}
      {hasPriority && (
        <span
          aria-hidden
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          style={{ backgroundColor: pmeta.color }}
        />
      )}

      {/* left-handed: drag handle leads */}
      {handedness === "left" && dragHandle}

      {/* done checkbox — generous hit area, clearly separated from the text */}
      {!locked && (
        <button
          onClick={onToggleDone}
          aria-label={done ? "Mark not done" : "Mark done"}
          title={done ? "Mark not done" : "Mark done"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-surface-2 cursor-pointer"
        >
          <span
            className={cn(
              "relative grid h-[1.15rem] w-[1.15rem] place-items-center rounded-full border-[1.5px] transition-colors",
              done
                ? "border-success bg-success text-success-fg"
                : "border-fg-subtle/60 text-transparent group-hover:border-fg-subtle hover:!border-success hover:text-success/60",
            )}
          >
            {justDone && <span className="absolute left-1/2 top-0 h-5 w-8 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--success)_1px,transparent_2px)] animate-confetti-pop" />}
            <Check className={cn("h-3 w-3", justDone && "animate-check-pop")} strokeWidth={3} />
          </span>
        </button>
      )}

      {/* actions menu — left of content; edit remains inside this menu */}
      {moreMenu}

      {/* body — dir="auto" so RTL (e.g. Hebrew/Arabic) lines display right-aligned */}
      <div className={cn("min-w-0 flex-1 pt-0.5", done && "text-fg-subtle/45 line-through decoration-fg-subtle/60 decoration-1 [&_.md]:text-fg-subtle/45 [&_.md]:line-through [&_.md]:decoration-fg-subtle/60 [&_.md]:decoration-1")} dir="auto">
        {locked ? (
          <div className={cn(isLong && !showFull && "max-h-[3.2rem] overflow-hidden")}>
            <Markdown content={note.body} />
          </div>
        ) : editing ? (
          <AutoGrow
            value={body}
            onChange={setBody}
            autoFocus
            dir="auto"
            onBlur={() => {
              setEditing(false);
              onSaveBody(body);
            }}
            className="text-[0.95rem] leading-relaxed"
          />
        ) : (
          <div className="cursor-pointer" onClick={onBodyClick}>
            <div className={cn(isLong && !showFull && "max-h-[3.2rem] overflow-hidden")}>
              <Markdown content={note.body} className={done ? "text-fg-subtle/45 line-through decoration-fg-subtle/60 decoration-1" : undefined} onToggleCheckbox={done ? undefined : onToggleCheckbox} />
            </div>
          </div>
        )}

        {isLong && !editing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowFull((v) => !v);
            }}
            className="mt-0.5 text-[0.6875rem] font-medium text-primary hover:underline cursor-pointer"
          >
            {showFull ? "Show less" : "Show more"}
          </button>
        )}

        {/* status row: queued chip / meta */}
        {(queued || note.pinned || note.attachments.some((a) => a.kind === "audio") || note.pending) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {queued && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-surface/70 px-1.5 py-0.5 text-[0.6875rem] font-medium">
                <Sparkles className="h-3 w-3 text-primary animate-pulse-soft" />
                <span className="ai-shimmer">
                  {note.assignedAgent ? `${note.assignedAgent.name} is filing this…` : "Waiting for an agent…"}
                </span>
              </span>
            )}
            {note.pinned && (
              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-primary">
                <Pin className="h-3 w-3 fill-current" /> pinned
              </span>
            )}
            {note.attachments.some((a) => a.kind === "audio") && (
              <Badge tone="aqua">
                <Mic className="h-3 w-3" /> memo
              </Badge>
            )}
            {note.pending && (
              <span suppressHydrationWarning className="inline-flex items-center gap-1 text-[0.6875rem] text-primary">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </span>
            )}
          </div>
        )}
      </div>

      {/* trailing queued control; drag handle remains in its handedness-controlled position */}
      {queued && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => onIngest(false)}
            title="Unmark"
            className="grid h-7 w-7 place-items-center rounded-md text-primary hover:bg-surface cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* right-handed: drag handle trails (thumb side on a phone) */}
      {handedness === "right" && dragHandle}
    </div>
  );
}

// ── small pieces ──────────────────────────────────────────────────────────────

function DayChip({
  value,
  schedule,
  onChange,
}: {
  value: string | null;
  schedule: Schedule;
  onChange: (day: string | null) => void;
}) {
  const current =
    schedule.sections.find((s) => s.day === value) ?? schedule.sections.find((s) => s.kind === "general")!;
  return (
    <Menu
      trigger={
        <button className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg cursor-pointer">
          <CalendarClock className="h-3.5 w-3.5" />
          {current.label}
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      {(close) => (
        <div className="min-w-[11rem]">
          {schedule.sections.map((s) => (
            <MenuItem
              key={s.key}
              active={s.day === value}
              onClick={() => {
                onChange(s.day);
                close();
              }}
            >
              <span className="flex-1">{s.label}</span>
              {s.sublabel && <span className="text-[0.6875rem] text-fg-subtle">{s.sublabel}</span>}
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  );
}
