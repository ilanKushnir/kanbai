"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Pin,
  Sparkles,
  Trash2,
  Archive,
  Mic,
  ArrowUpRight,
  Loader2,
  NotebookPen,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SortSheet } from "./sort-sheet";
import { api } from "@/lib/client-api";
import { timeAgo, cn } from "@/lib/utils";
import type { NoteT, AgentLite } from "@/lib/types";

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
  // Re-measure when the textarea's WIDTH settles (layout, font load, window resize).
  // Guarded on width so our own height changes don't loop.
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

export function NotesView({ notes: initial, agents }: { notes: NoteT[]; agents: AgentLite[] }) {
  const router = useRouter();
  const [notes, setNotes] = React.useState<NoteT[]>(initial);
  const [draft, setDraft] = React.useState("");
  const [sortNote, setSortNote] = React.useState<NoteT | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

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
      alert(e instanceof Error ? e.message : "Failed to add note");
    }
  }

  async function saveBody(id: string, body: string) {
    const trimmed = body.trim();
    const cur = notes.find((n) => n.id === id);
    if (!cur || trimmed === cur.body || !trimmed) return;
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}`, {
        method: "PATCH",
        body: { body: trimmed },
      });
      upsert(note);
    } catch {
      /* ignore */
    }
  }

  async function patchNote(id: string, partial: Record<string, unknown>) {
    try {
      const { note } = await api<{ note: NoteT }>(`/api/notes/${id}`, { method: "PATCH", body: partial });
      upsert(note);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
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

  const active = notes
    .filter((n) => n.status === "inbox" || n.status === "queued")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.createdAt) - +new Date(a.createdAt));
  const sorted = notes.filter((n) => n.status === "sorted");
  const archived = notes.filter((n) => n.status === "archived");

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
          placeholder="Jot something down…  (Enter to save, Shift+Enter for a new line)"
          className="px-1 text-[0.95rem] leading-relaxed min-h-6"
        />
        {draft.trim() && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={addNote}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-hover cursor-pointer"
            >
              Save note
            </button>
          </div>
        )}
      </div>

      {/* Active scraps */}
      <div className="mt-5 space-y-2.5">
        {active.length === 0 && sorted.length === 0 && archived.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="Your inbox is clear"
            description="Capture a thought above — then swipe it to an agent to file it where it belongs."
            className="mt-6"
          />
        ) : (
          active.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onSaveBody={(body) => saveBody(n.id, body)}
              onPin={() => patchNote(n.id, { pinned: !n.pinned })}
              onSort={() => setSortNote(n)}
              onArchive={() => patchNote(n.id, { status: "archived" })}
              onDelete={() => del(n.id)}
            />
          ))
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
              <div
                key={n.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5"
              >
                <Avatar
                  name={n.assignedAgent?.name ?? "Agent"}
                  color={n.assignedAgent?.color}
                  isAgent
                  size={24}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg-muted line-through decoration-fg-subtle/40">
                    {n.body}
                  </p>
                </div>
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
                    onClick={() => del(n.id)}
                    className="shrink-0 text-fg-subtle hover:text-danger cursor-pointer"
                    aria-label="Delete"
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
        <SortSheet
          note={sortNote}
          agents={agents}
          onClose={() => setSortNote(null)}
          onQueued={(updated) => {
            upsert(updated);
            setSortNote(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function NoteCard({
  note,
  onSaveBody,
  onPin,
  onSort,
  onArchive,
  onDelete,
}: {
  note: NoteT;
  onSaveBody: (body: string) => void;
  onPin: () => void;
  onSort: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [body, setBody] = React.useState(note.body);
  React.useEffect(() => setBody(note.body), [note.body]);
  const queued = note.status === "queued";

  return (
    <div
      className={cn(
        "group rounded-2xl border bg-surface p-3.5 shadow-card transition-all",
        note.pinned ? "border-primary/30" : "border-border",
        queued && "bg-primary-soft/30",
      )}
    >
      <div className="flex items-start gap-2">
        {note.pinned && <Pin className="mt-1 h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}
        {queued ? (
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-[0.95rem] leading-relaxed">{note.body}</p>
        ) : (
          <AutoGrow
            value={body}
            onChange={setBody}
            onBlur={() => onSaveBody(body)}
            className="min-w-0 flex-1 text-[0.95rem] leading-relaxed"
          />
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
          <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
            <IconBtn label="Pin" onClick={onPin} active={note.pinned}>
              <Pin className={cn("h-4 w-4", note.pinned && "fill-current")} />
            </IconBtn>
            <IconBtn label="Archive" onClick={onArchive}>
              <Archive className="h-4 w-4" />
            </IconBtn>
            <IconBtn label="Delete" onClick={onDelete} danger>
              <Trash2 className="h-4 w-4" />
            </IconBtn>
            <button
              onClick={onSort}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Sort
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
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors cursor-pointer",
        active && "text-primary",
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
