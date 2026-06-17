"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isToday, isYesterday, differenceInCalendarDays } from "date-fns";
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
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown, toggleTask } from "@/components/ui/markdown";
import { useToast } from "@/components/ui/toast";
import { ProcessSheet } from "./process-sheet";
import { useDictation } from "./use-dictation";
import { api } from "@/lib/client-api";
import { timeAgo, cn } from "@/lib/utils";
import type { NoteT, AgentLite, BoardLite } from "@/lib/types";

function AutoGrow({
  value,
  onChange,
  onBlur,
  onSubmit,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
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
      placeholder={placeholder}
      className={cn("w-full resize-none bg-transparent outline-none placeholder:text-fg-subtle", className)}
    />
  );
}

function groupByDate(notes: NoteT[]) {
  const groups: { label: string; notes: NoteT[] }[] = [
    { label: "Today", notes: [] },
    { label: "Yesterday", notes: [] },
    { label: "Previous 7 days", notes: [] },
    { label: "Earlier", notes: [] },
  ];
  for (const n of notes) {
    const d = new Date(n.createdAt);
    if (isToday(d)) groups[0].notes.push(n);
    else if (isYesterday(d)) groups[1].notes.push(n);
    else if (differenceInCalendarDays(new Date(), d) <= 7) groups[2].notes.push(n);
    else groups[3].notes.push(n);
  }
  return groups.filter((g) => g.notes.length);
}

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
  const [notes, setNotes] = React.useState<NoteT[]>(initial);
  const [draft, setDraft] = React.useState("");
  const dictateBase = React.useRef("");
  const dictation = useDictation((text) => {
    setDraft((dictateBase.current ? dictateBase.current + " " : "") + text);
  });
  const [query, setQuery] = React.useState("");
  const [sortNote, setSortNote] = React.useState<NoteT | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const focusId = params.get("focus");
  const composeFocus = params.get("compose") === "1";

  function upsert(n: NoteT) {
    setNotes((prev) => {
      const i = prev.findIndex((x) => x.id === n.id);
      if (i === -1) return [n, ...prev];
      const copy = [...prev];
      copy[i] = n;
      return copy;
    });
  }

  async function addNote() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    try {
      const { note } = await api<{ note: NoteT }>("/api/notes", { body: { body } });
      upsert(note);
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't add note", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  async function saveBody(id: string, body: string) {
    const trimmed = body;
    const cur = notes.find((n) => n.id === id);
    if (!cur || trimmed === cur.body || !trimmed.trim()) return;
    // optimistic
    upsert({ ...cur, body: trimmed });
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}`, { method: "PATCH", body: { body: trimmed } });
      upsert(note);
    } catch {
      router.refresh();
    }
  }

  async function patchNote(id: string, partial: Record<string, unknown>, refresh = true) {
    const cur = notes.find((n) => n.id === id);
    if (cur) upsert({ ...cur, ...(partial as Partial<NoteT>) });
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}`, { method: "PATCH", body: partial });
      upsert(note);
      if (refresh) router.refresh();
    } catch (e) {
      toast({ title: "Something went wrong", description: e instanceof Error ? e.message : undefined, variant: "error" });
      router.refresh();
    }
  }

  function archive(note: NoteT) {
    patchNote(note.id, { status: "archived" });
    toast({
      title: "Note archived",
      actionLabel: "Undo",
      onAction: () => patchNote(note.id, { status: "inbox" }),
    });
  }

  async function del(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await api(`/api/notes/${id}`, { method: "DELETE" });
      router.refresh();
    } catch {
      router.refresh();
    }
  }

  function toggleCheckbox(note: NoteT, index: number) {
    saveBody(note.id, toggleTask(note.body, index));
  }

  const q = query.trim().toLowerCase();
  const matches = (n: NoteT) => !q || n.body.toLowerCase().includes(q);

  const activeAll = notes.filter((n) => n.status === "inbox" || n.status === "queued").filter(matches);
  const pinned = activeAll.filter((n) => n.pinned).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const unpinned = activeAll
    .filter((n) => !n.pinned)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const dateGroups = q
    ? [{ label: "Results", notes: unpinned }]
    : groupByDate(unpinned);
  const sorted = notes.filter((n) => n.status === "sorted").filter(matches);
  const archived = notes.filter((n) => n.status === "archived");

  const renderNote = (n: NoteT) => (
    <NoteCard
      key={n.id}
      note={n}
      highlight={focusId === n.id}
      onSaveBody={(body) => saveBody(n.id, body)}
      onToggleCheckbox={(i) => toggleCheckbox(n, i)}
      onPin={() => patchNote(n.id, { pinned: !n.pinned })}
      onSort={() => setSortNote(n)}
      onArchive={() => archive(n)}
    />
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Notes</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Capture fast. Send a scrap to an agent and it becomes a real ticket.
        </p>
      </header>

      {/* Composer */}
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <AutoGrow
          value={draft}
          onChange={setDraft}
          onSubmit={addNote}
          autoFocus={composeFocus}
          placeholder="Jot something down…  Try - [ ] a checklist"
          className="px-1 text-[0.95rem] leading-relaxed min-h-6"
        />
        {(dictation.supported || draft.trim()) && (
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
                    dictation.listening
                      ? "bg-danger text-white animate-pulse-soft"
                      : "bg-surface-2 text-fg-muted hover:text-fg",
                  )}
                >
                  <Mic className="h-3.5 w-3.5" />
                  {dictation.listening ? "Listening… tap to stop" : "Dictate"}
                </button>
              )}
              <span className="hidden items-center gap-1 truncate text-[0.6875rem] text-fg-subtle sm:flex">
                <ListChecks className="h-3.5 w-3.5" /> Markdown, checklists &amp; @due !priority #labels
              </span>
            </div>
            {draft.trim() && (
              <button
                onClick={() => {
                  dictation.stop();
                  addNote();
                }}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-hover cursor-pointer"
              >
                Save note
              </button>
            )}
          </div>
        )}
      </div>

      {/* Search */}
      {notes.length > 3 && (
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

      {/* Lists */}
      <div className="mt-5">
        {activeAll.length === 0 && sorted.length === 0 && archived.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="Your inbox is clear"
            description="Capture a thought above — then send it to an agent to file it where it belongs."
            className="mt-6"
          />
        ) : activeAll.length === 0 && q ? (
          <p className="px-1 py-6 text-center text-sm text-fg-subtle">No notes match “{query}”.</p>
        ) : (
          <div className="space-y-5">
            {pinned.length > 0 && (
              <Section label="Pinned">{pinned.map(renderNote)}</Section>
            )}
            {dateGroups.map((g) => (
              <Section key={g.label} label={g.label}>
                {g.notes.map(renderNote)}
              </Section>
            ))}
          </div>
        )}
      </div>

      {/* Sorted */}
      {sorted.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Sorted into tickets
          </h2>
          <div className="space-y-2">
            {sorted.map((n) => (
              <div key={n.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
                <Avatar name={n.assignedAgent?.name ?? "Agent"} color={n.assignedAgent?.color} isAgent size={24} />
                <p className="min-w-0 flex-1 truncate text-sm text-fg-muted line-through decoration-fg-subtle/40">
                  {n.body}
                </p>
                {n.ticket && (
                  <Link
                    href={`/boards`}
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
                    onClick={() => patchNote(n.id, { status: "inbox" })}
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
            upsert(updated);
            setSortNote(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{label}</h2>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function NoteCard({
  note,
  highlight,
  onSaveBody,
  onToggleCheckbox,
  onPin,
  onSort,
  onArchive,
}: {
  note: NoteT;
  highlight?: boolean;
  onSaveBody: (body: string) => void;
  onToggleCheckbox: (index: number) => void;
  onPin: () => void;
  onSort: () => void;
  onArchive: () => void;
}) {
  const queued = note.status === "queued";
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(note.body);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setBody(note.body), [note.body]);

  React.useEffect(() => {
    if (highlight && ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  return (
    <div
      ref={ref}
      className={cn(
        "group rounded-2xl border bg-surface p-3.5 shadow-card transition-all",
        note.pinned ? "border-primary/30" : "border-border",
        queued && "bg-primary-soft/30",
        highlight && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start gap-2">
        {note.pinned && <Pin className="mt-1 h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}
        {queued ? (
          <div className="min-w-0 flex-1">
            <Markdown content={note.body} />
          </div>
        ) : editing ? (
          <AutoGrow
            value={body}
            onChange={setBody}
            autoFocus
            onBlur={() => {
              setEditing(false);
              onSaveBody(body);
            }}
            className="min-w-0 flex-1 text-[0.95rem] leading-relaxed"
          />
        ) : (
          <div
            className="min-w-0 flex-1 cursor-text"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, input, button")) return;
              setEditing(true);
            }}
          >
            <Markdown content={note.body} onToggleCheckbox={onToggleCheckbox} />
          </div>
        )}
      </div>

      {queued && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-surface/70 px-2.5 py-1.5">
          <Avatar name={note.assignedAgent?.name ?? "Agent"} color={note.assignedAgent?.color} isAgent size={20} />
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {note.assignedAgent?.name} is sorting…
          </span>
          {note.attachments.some((a) => a.kind === "audio") && (
            <Badge tone="aqua">
              <Mic className="h-3 w-3" /> memo
            </Badge>
          )}
        </div>
      )}

      {note.sortContext && queued && (
        <p className="mt-1.5 px-0.5 text-xs italic text-fg-subtle">“{note.sortContext}”</p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span suppressHydrationWarning className="text-[0.6875rem] text-fg-subtle">
          {timeAgo(note.createdAt)}
        </span>
        {!queued && (
          <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
            <IconBtn label="Pin" onClick={onPin} active={note.pinned}>
              <Pin className={cn("h-4 w-4", note.pinned && "fill-current")} />
            </IconBtn>
            <IconBtn label="Archive" onClick={onArchive}>
              <Archive className="h-4 w-4" />
            </IconBtn>
            <button
              onClick={onSort}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              File
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors cursor-pointer hover:bg-surface-2 hover:text-fg",
        active && "text-primary",
      )}
    >
      {children}
    </button>
  );
}
