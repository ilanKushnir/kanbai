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
  Search,
  ListChecks,
  GripVertical,
  ChevronDown,
  MoreHorizontal,
  Inbox,
  X,
  CalendarClock,
  CornerDownLeft,
  AlignLeft,
  AlignRight,
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
import { timeAgo, cn } from "@/lib/utils";
import { NOTE_BUCKETS, BUCKET_LABEL, PRIORITIES, PRIORITY_META, type NoteBucket } from "@/lib/constants";
import type { NoteT, AgentLite, BoardLite } from "@/lib/types";

// ── helpers ────────────────────────────────────────────────────────────────

const ACTIVE = (n: NoteT) => n.status === "inbox" || n.status === "queued";
function bucketOf(n: NoteT): NoteBucket {
  return (NOTE_BUCKETS as readonly string[]).includes(n.bucket) ? (n.bucket as NoteBucket) : "general";
}

/** Group active notes into ordered id-lists per bucket (preserving incoming order). */
function buildContainers(notes: NoteT[]): Record<NoteBucket, string[]> {
  const m = Object.fromEntries(NOTE_BUCKETS.map((b) => [b, [] as string[]])) as Record<NoteBucket, string[]>;
  for (const n of notes) if (ACTIVE(n)) m[bucketOf(n)].push(n.id);
  return m;
}

const QUEUE_KEY = "kanbai-note-queue";
type QueueItem = { tempId: string; body: string; bucket: NoteBucket; priority?: string };
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
function makeTempNote(body: string, bucket: NoteBucket): NoteT {
  const now = new Date().toISOString();
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    body,
    status: "inbox",
    pinned: false,
    bucket,
    position: 9999,
    priority: "none",
    suggestedDueDate: null,
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
}: {
  notes: NoteT[];
  agents: AgentLite[];
  boards: BoardLite[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  const [notesById, setNotesById] = React.useState<Record<string, NoteT>>(() =>
    Object.fromEntries(initial.map((n) => [n.id, n])),
  );
  const [containers, setContainers] = React.useState<Record<NoteBucket, string[]>>(() => buildContainers(initial));
  const containersRef = React.useRef(containers);
  const setCont = (next: Record<NoteBucket, string[]>) => {
    containersRef.current = next;
    setContainers(next);
  };
  const notesRef = React.useRef(notesById);
  notesRef.current = notesById;
  const upsertNote = (n: NoteT) => setNotesById((m) => ({ ...m, [n.id]: n }));

  const [draft, setDraft] = React.useState("");
  const [draftBucket, setDraftBucket] = React.useState<NoteBucket>("today");
  const [composerDir, setComposerDir] = React.useState<"ltr" | "rtl">("ltr");
  React.useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("kanbai-compose-dir") : null;
    if (saved === "rtl" || saved === "ltr") setComposerDir(saved);
  }, []);
  function toggleDir() {
    setComposerDir((d) => {
      const next = d === "ltr" ? "rtl" : "ltr";
      try {
        localStorage.setItem("kanbai-compose-dir", next);
      } catch {
        /* noop */
      }
      return next;
    });
  }
  const dictateBase = React.useRef("");
  const dictation = useDictation((text) => {
    setDraft((dictateBase.current ? dictateBase.current + " " : "") + text);
  });
  const [query, setQuery] = React.useState("");
  const [sortNote, setSortNote] = React.useState<NoteT | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<NoteBucket>>(
    () => new Set(NOTE_BUCKETS.filter((b) => buildContainers(initial)[b].length === 0)),
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const focusId = params.get("focus");
  const composeFocus = params.get("compose") === "1";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── capture ────────────────────────────────────────────────────────────────
  async function addNote(body: string, bucket: NoteBucket, priority = "none") {
    const text = body.trim();
    if (!text) return;
    const optimistic = makeTempNote(text, bucket);
    optimistic.priority = priority;
    upsertNote(optimistic);
    setCont({ ...containersRef.current, [bucket]: [...containersRef.current[bucket], optimistic.id] });
    setCollapsed((s) => {
      const next = new Set(s);
      next.delete(bucket);
      return next;
    });
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
      const { note } = await api<{ note: NoteT }>("/api/notes", { body: { body: text, bucket, priority } });
      replaceTemp(optimistic.id, note);
      router.refresh();
    } catch {
      writeQueue([...readQueue(), { tempId: optimistic.id, body: text, bucket, priority }]);
      toast({ title: "Saved offline", description: "It'll sync when you're back online.", variant: "info" });
    }
  }

  function replaceTemp(tempId: string, note: NoteT) {
    setNotesById((m) => {
      const next = { ...m };
      delete next[tempId];
      next[note.id] = note;
      return next;
    });
    // Swap the temp id in whichever bucket currently holds it — the user may
    // have dragged the pending note to a different bucket than it was created in.
    const next = { ...containersRef.current };
    for (const b of NOTE_BUCKETS) {
      if (next[b].includes(tempId)) next[b] = next[b].map((id) => (id === tempId ? note.id : id));
    }
    setCont(next);
  }

  function submitDraft() {
    if (!draft.trim()) return;
    dictation.stop();
    addNote(draft, draftBucket);
    setDraft("");
  }

  // ── offline replay ───────────────────────────────────────────────────────────
  const flushingRef = React.useRef(false);
  const flush = React.useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (flushingRef.current || readQueue().length === 0) return; // single-flight: no concurrent replays
    flushingRef.current = true;
    (async () => {
      try {
        for (const item of readQueue()) {
          try {
            const { note } = await api<{ note: NoteT }>("/api/notes", {
              body: { body: item.body, bucket: item.bucket, priority: item.priority },
            });
            replaceTemp(item.tempId, note);
            writeQueue(readQueue().filter((x) => x.tempId !== item.tempId));
          } catch {
            break; // stay queued; retry next reconnect
          }
        }
      } finally {
        flushingRef.current = false;
      }
      router.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  React.useEffect(() => {
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  // ── mutations ────────────────────────────────────────────────────────────────
  async function patchNote(id: string, partial: Record<string, unknown>, refresh = false) {
    const cur = notesRef.current[id];
    if (cur) upsertNote({ ...cur, ...(partial as Partial<NoteT>) });
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}`, { method: "PATCH", body: partial });
      upsertNote(note);
      if (refresh) router.refresh();
    } catch (e) {
      toast({ title: "Something went wrong", description: e instanceof Error ? e.message : undefined, variant: "error" });
      router.refresh();
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

  function removeFromContainers(id: string) {
    const b = Object.keys(containersRef.current).find((k) =>
      containersRef.current[k as NoteBucket].includes(id),
    ) as NoteBucket | undefined;
    if (b) setCont({ ...containersRef.current, [b]: containersRef.current[b].filter((x) => x !== id) });
  }

  function archive(id: string) {
    const cur = notesRef.current[id];
    removeFromContainers(id);
    if (cur) upsertNote({ ...cur, status: "archived" });
    void api(`/api/notes/${id}`, { method: "PATCH", body: { status: "archived" } }).catch(() => router.refresh());
    toast({
      title: "Note archived",
      actionLabel: "Undo",
      onAction: () => restore(id),
    });
  }

  function restore(id: string) {
    const cur = notesRef.current[id];
    if (!cur) return;
    const b = bucketOf(cur);
    upsertNote({ ...cur, status: "inbox" });
    if (!containersRef.current[b].includes(id))
      setCont({ ...containersRef.current, [b]: [...containersRef.current[b], id] });
    void api(`/api/notes/${id}`, { method: "PATCH", body: { status: "inbox" } }).catch(() => router.refresh());
  }

  async function del(id: string) {
    removeFromContainers(id);
    setNotesById((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    try {
      await api(`/api/notes/${id}`, { method: "DELETE" });
    } catch {
      router.refresh();
    }
  }

  /** Toggle the per-line "mark for ingestion" flag. The line stays in place. */
  async function toggleIngest(id: string, ingest: boolean) {
    const cur = notesRef.current[id];
    if (cur) upsertNote({ ...cur, status: ingest ? "queued" : "inbox" });
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
    }
  }

  function toggleCheckbox(note: NoteT, index: number) {
    saveBody(note.id, toggleTask(note.body, index));
  }

  // ── drag & drop across buckets ───────────────────────────────────────────────
  function keyOf(map: Record<string, string[]>, id: string): NoteBucket | null {
    if (id in map) return id as NoteBucket;
    return (Object.keys(map).find((k) => map[k].includes(id)) as NoteBucket | undefined) ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const aId = String(active.id);
    const overId = String(over.id);
    const prev = containersRef.current as Record<string, string[]>;
    const activeContainer = keyOf(prev, aId);
    const overContainer = overId in prev ? (overId as NoteBucket) : keyOf(prev, overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    const activeItems = prev[activeContainer];
    const overItems = prev[overContainer];
    const overIndex = overId in prev ? overItems.length : Math.max(0, overItems.indexOf(overId));
    setCont({
      ...(prev as Record<NoteBucket, string[]>),
      [activeContainer]: activeItems.filter((id) => id !== aId),
      [overContainer]: [...overItems.slice(0, overIndex), aId, ...overItems.slice(overIndex)],
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const aId = String(active.id);
    const overId = String(over.id);
    const prev = containersRef.current as Record<string, string[]>;
    const activeContainer = keyOf(prev, aId);
    if (!activeContainer) return;
    const overContainer = overId in prev ? (overId as NoteBucket) : keyOf(prev, overId);

    let result = prev;
    if (overContainer && activeContainer === overContainer) {
      const items = prev[activeContainer];
      const oldIndex = items.indexOf(aId);
      const newIndex = overId in prev ? items.length - 1 : items.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        result = { ...prev, [activeContainer]: arrayMove(items, oldIndex, newIndex) };
        setCont(result as Record<NoteBucket, string[]>);
      }
    }

    const finalContainer = keyOf(result, aId);
    if (!finalContainer) return;
    const finalIndex = result[finalContainer].indexOf(aId);
    void persistMove(aId, finalContainer, finalIndex);
  }

  async function persistMove(id: string, bucket: NoteBucket, position: number) {
    // reflect new bucket locally right away (affects suggested due date chip)
    const cur = notesRef.current[id];
    if (cur && cur.bucket !== bucket) upsertNote({ ...cur, bucket });
    if (id.startsWith("tmp-")) return; // offline-pending note; will sync first
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}/move`, { body: { bucket, position } });
      upsertNote(note);
    } catch {
      toast({ title: "Couldn't move note", variant: "error" });
      router.refresh();
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const allNotes = Object.values(notesById);
  const sorted = allNotes
    .filter((n) => n.status === "sorted" && (!q || n.body.toLowerCase().includes(q)))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const archived = allNotes.filter((n) => n.status === "archived");
  const totalActive = NOTE_BUCKETS.reduce((sum, b) => sum + containers[b].length, 0);

  const dragging = !!activeId;
  function isOpen(b: NoteBucket, count: number) {
    if (dragging) return true; // every bucket becomes a drop target mid-drag
    if (q) return count > 0;
    return !collapsed.has(b);
  }
  function toggleBucket(b: NoteBucket) {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  }

  const matchId = (id: string) => {
    if (!q) return true;
    return (notesById[id]?.body ?? "").toLowerCase().includes(q);
  };

  const activeNote = activeId ? notesById[activeId] : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Notes</h1>
        <p className="mt-1 text-sm text-fg-muted">
          One running note, split by when. Drop a line in the right slot, mark it for an agent, and it becomes a ticket.
        </p>
      </header>

      {/* Composer */}
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-card transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <AutoGrow
          value={draft}
          onChange={setDraft}
          onSubmit={submitDraft}
          autoFocus={composeFocus}
          dir={composerDir}
          placeholder="Jot something down…  Try - [ ] a checklist"
          className="px-1 text-[0.95rem] leading-relaxed min-h-6"
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
                {dictation.listening ? "Listening… tap to stop" : "Dictate"}
              </button>
            )}
            <button
              onClick={toggleDir}
              title={composerDir === "rtl" ? "Right-to-left — tap for LTR" : "Left-to-right — tap for RTL"}
              aria-label="Toggle text direction"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-surface-2 p-1.5 text-fg-muted transition-colors hover:text-fg cursor-pointer"
            >
              {composerDir === "rtl" ? <AlignRight className="h-3.5 w-3.5" /> : <AlignLeft className="h-3.5 w-3.5" />}
            </button>
            <BucketChip value={draftBucket} onChange={setDraftBucket} />
          </div>
          {draft.trim() && (
            <button
              onClick={submitDraft}
              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-hover cursor-pointer"
            >
              Add line
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      {allNotes.length > 4 && (
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {/* Buckets */}
      <DndContext
        id="kanbai-notes"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="mt-5 divide-y divide-border/60 rounded-2xl border border-border bg-surface/40">
          {NOTE_BUCKETS.map((b) => {
            const ids = containers[b].filter(matchId);
            const open = isOpen(b, ids.length);
            return (
              <BucketSection
                key={b}
                bucket={b}
                open={open}
                count={containers[b].length}
                ids={ids}
                notesById={notesById}
                focusId={focusId}
                dragDisabled={!!q}
                onToggle={() => toggleBucket(b)}
                onAdd={(text) => addNote(text, b)}
                onSaveBody={saveBody}
                onToggleCheckbox={toggleCheckbox}
                onSetPriority={setPriority}
                onPin={(id, pinned) => patchNote(id, { pinned })}
                onArchive={archive}
                onDelete={del}
                onIngest={toggleIngest}
                onFile={(n) => setSortNote(n)}
              />
            );
          })}
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
          description="Jot a line above — then drag it to when it matters, or mark it for an agent to file."
          className="mt-6"
        />
      )}
      {totalActive === 0 && q && (
        <p className="px-1 py-6 text-center text-sm text-fg-subtle">No notes match “{query}”.</p>
      )}

      {/* Filed (sorted into tickets) */}
      {sorted.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Filed into tickets</h2>
          <div className="space-y-2">
            {sorted.map((n) => (
              <div key={n.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
                <Avatar name={n.assignedAgent?.name ?? "Agent"} color={n.assignedAgent?.color} isAgent size={24} />
                <p className="min-w-0 flex-1 truncate text-sm text-fg-muted line-through decoration-fg-subtle/40">
                  {n.body}
                </p>
                {n.ticket && (
                  <Link
                    href="/boards"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
                  >
                    View ticket <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

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
            removeFromContainers(updated.id);
            upsertNote(updated);
            setSortNote(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── bucket section ────────────────────────────────────────────────────────────

function BucketSection({
  bucket,
  open,
  count,
  ids,
  notesById,
  focusId,
  dragDisabled,
  onToggle,
  onAdd,
  onSaveBody,
  onToggleCheckbox,
  onSetPriority,
  onPin,
  onArchive,
  onDelete,
  onIngest,
  onFile,
}: {
  bucket: NoteBucket;
  open: boolean;
  count: number;
  ids: string[];
  notesById: Record<string, NoteT>;
  focusId: string | null;
  dragDisabled?: boolean;
  onToggle: () => void;
  onAdd: (text: string) => void;
  onSaveBody: (id: string, body: string) => void;
  onToggleCheckbox: (note: NoteT, index: number) => void;
  onSetPriority: (id: string, p: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onIngest: (id: string, ingest: boolean) => void;
  onFile: (note: NoteT) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: bucket });
  const [adding, setAdding] = React.useState(false);
  const [addText, setAddText] = React.useState("");

  function commitAdd() {
    if (addText.trim()) onAdd(addText);
    setAddText("");
    // keep the row open for rapid line-by-line entry
  }

  return (
    <div ref={setNodeRef} className={cn("px-2 py-1.5 transition-colors", isOver && "bg-primary-soft/30")}>
      <button
        onClick={onToggle}
        className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2/60 cursor-pointer"
      >
        <ChevronDown
          className={cn("h-4 w-4 text-fg-subtle transition-transform", !open && "-rotate-90")}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{BUCKET_LABEL[bucket]}</span>
        {count > 0 && <span className="text-xs font-medium text-fg-subtle">{count}</span>}
      </button>

      {open && (
        <div className="pb-1 pl-1.5">
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
                    dragDisabled={dragDisabled}
                    onSaveBody={(body) => onSaveBody(id, body)}
                    onToggleCheckbox={(i) => onToggleCheckbox(n, i)}
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

          {/* inline add line */}
          {adding ? (
            <div className="flex items-start gap-2 rounded-lg px-2 py-1.5">
              <CornerDownLeft className="mt-1 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              <AutoGrow
                value={addText}
                onChange={setAddText}
                autoFocus
                onSubmit={commitAdd}
                onBlur={() => {
                  commitAdd();
                  setAdding(false);
                }}
                placeholder={`Add to ${BUCKET_LABEL[bucket]}…`}
                className="text-[0.95rem] leading-relaxed"
              />
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-subtle hover:bg-surface-2/60 hover:text-fg-muted cursor-pointer"
            >
              <span className="grid h-4 w-4 place-items-center text-fg-subtle">+</span>
              Add a line
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── a single note line ─────────────────────────────────────────────────────────

function NoteRow({
  note,
  highlight,
  dragDisabled,
  onSaveBody,
  onToggleCheckbox,
  onSetPriority,
  onPin,
  onArchive,
  onDelete,
  onIngest,
  onFile,
}: {
  note: NoteT;
  highlight?: boolean;
  dragDisabled?: boolean;
  onSaveBody: (body: string) => void;
  onToggleCheckbox: (index: number) => void;
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
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(note.body);
  const rowRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setBody(note.body), [note.body]);
  React.useEffect(() => {
    if (highlight && rowRef.current) rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  const pmeta = PRIORITY_META[(note.priority as keyof typeof PRIORITY_META) ?? "none"] ?? PRIORITY_META.none;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-start gap-1.5 rounded-lg py-1.5 pl-1 pr-1.5 transition-colors",
        !isDragging && "hover:bg-surface-2/50",
        isDragging && "opacity-40",
        queued && "bg-primary-soft/40",
        highlight && "ring-2 ring-primary",
      )}
    >
      <div ref={rowRef} className="absolute -top-px left-0 h-0 w-0" />

      {/* drag handle — visible on touch, hover-revealed on desktop; hidden while searching */}
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        disabled={dragDisabled}
        className={cn(
          "mt-0.5 shrink-0 cursor-grab touch-none text-fg-subtle opacity-40 transition-opacity hover:text-fg-muted active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100",
          dragDisabled && "pointer-events-none !opacity-0",
        )}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* priority dot / bullet */}
      <PriorityDot
        priority={note.priority}
        color={pmeta.color}
        onSelect={onSetPriority}
        className={cn("mt-[0.45rem]", "group-hover:opacity-100", note.priority === "none" && "opacity-60")}
      />

      {/* body — dir="auto" so RTL (e.g. Hebrew/Arabic) lines display right-aligned */}
      <div className="min-w-0 flex-1" dir="auto">
        {locked ? (
          <Markdown content={note.body} />
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
          <div
            className="cursor-text"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, input, button")) return;
              setEditing(true);
            }}
          >
            <Markdown content={note.body} onToggleCheckbox={onToggleCheckbox} />
          </div>
        )}

        {/* status row: queued chip / meta */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {queued ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-surface/70 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {note.assignedAgent ? `${note.assignedAgent.name} is filing this…` : "Waiting for an agent…"}
            </span>
          ) : note.suggestedDueDate ? (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-subtle">
              <CalendarClock className="h-3 w-3" />
              due {new Date(note.suggestedDueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          ) : null}
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
      </div>

      {/* trailing controls */}
      <div className="flex shrink-0 items-center gap-0.5">
        {queued ? (
          <button
            onClick={() => onIngest(false)}
            title="Unmark"
            className="grid h-7 w-7 place-items-center rounded-md text-primary hover:bg-surface cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          !note.pending && (
            <button
              onClick={() => onIngest(true)}
              title="Mark for an agent to file"
              className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle opacity-100 transition-opacity hover:bg-surface-2 hover:text-primary cursor-pointer md:opacity-0 md:group-hover:opacity-100"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          )
        )}

        {!locked && (
          <Menu
            align="end"
            trigger={
              <button
                title="More"
                className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle opacity-100 transition-opacity hover:bg-surface-2 hover:text-fg cursor-pointer md:opacity-0 md:group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            {(close) => (
              <>
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
        )}
      </div>
    </div>
  );
}

// ── small pieces ──────────────────────────────────────────────────────────────

function PriorityDot({
  priority,
  color,
  onSelect,
  className,
}: {
  priority: string;
  color: string;
  onSelect: (p: string) => void;
  className?: string;
}) {
  return (
    <Menu
      className={cn("shrink-0", className)}
      trigger={
        <button
          title={`Priority: ${PRIORITY_META[(priority as keyof typeof PRIORITY_META) ?? "none"]?.label ?? "None"}`}
          className="grid h-4 w-4 place-items-center cursor-pointer"
        >
          {priority === "none" ? (
            <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-fg-subtle" />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          )}
        </button>
      }
    >
      {(close) => (
        <div className="min-w-[9rem]">
          {PRIORITIES.map((p) => {
            const m = PRIORITY_META[p];
            return (
              <MenuItem
                key={p}
                active={priority === p}
                onClick={() => {
                  onSelect(p);
                  close();
                }}
              >
                {p === "none" ? (
                  <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-fg-subtle" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                )}
                {m.label}
              </MenuItem>
            );
          })}
        </div>
      )}
    </Menu>
  );
}

function BucketChip({ value, onChange }: { value: NoteBucket; onChange: (b: NoteBucket) => void }) {
  return (
    <Menu
      trigger={
        <button className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg cursor-pointer">
          <CalendarClock className="h-3.5 w-3.5" />
          {BUCKET_LABEL[value]}
          <ChevronDown className="h-3 w-3" />
        </button>
      }
    >
      {(close) => (
        <div className="min-w-[9rem]">
          {NOTE_BUCKETS.map((b) => (
            <MenuItem
              key={b}
              active={value === b}
              onClick={() => {
                onChange(b);
                close();
              }}
            >
              {BUCKET_LABEL[b]}
            </MenuItem>
          ))}
        </div>
      )}
    </Menu>
  );
}
