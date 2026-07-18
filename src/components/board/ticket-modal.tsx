"use client";

import * as React from "react";
import {
  Trash2,
  Flag,
  CalendarClock,
  Tag,
  Columns3,
  CornerDownLeft,
  X,
  NotebookPen,
  Check,
  CircleCheck,
  ListChecks,
  Plus,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { RichText } from "@/components/ui/rich-text";
import { RichEditor } from "@/components/ui/rich-editor";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { priorityMeta, dueMeta } from "@/lib/display";
import { timeAgo, cn } from "@/lib/utils";
import type { SerializedTicket } from "@/lib/serialize";

type ColumnMeta = { id: string; name: string; isDone: boolean; subStates: string[] };
type LabelLite = { id: string; name: string; color: string };
type AgentLite = { id: string; name: string; color: string; kind: string };
type MemberLite = { id: string; name: string; avatarUrl?: string | null };

export function TicketModal({
  ticket,
  columns,
  labels,
  agents,
  members = [],
  currentUser,
  onClose,
  onUpdated,
  onDeleted,
  onMoveToDone,
}: {
  ticket: SerializedTicket;
  columns: ColumnMeta[];
  labels: LabelLite[];
  agents: AgentLite[];
  /** Everyone who can see this board (managers + shared members) — assignable. */
  members?: MemberLite[];
  currentUser?: { id: string; name: string } | null;
  onClose: () => void;
  onUpdated: (t: SerializedTicket) => void;
  onDeleted: (id: string) => void;
  onMoveToDone?: () => Promise<SerializedTicket>;
}) {
  const { toast } = useToast();
  const [t, setT] = React.useState(ticket);
  const [title, setTitle] = React.useState(ticket.title);
  const [desc, setDesc] = React.useState(ticket.description);
  const [editingDesc, setEditingDesc] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  function apply(next: SerializedTicket) {
    setT(next);
    onUpdated(next);
  }

  async function patch(partial: Record<string, unknown>) {
    setSaving(true);
    try {
      const { ticket: next } = await api<{ ticket: SerializedTicket }>(`/api/tickets/${t.id}`, {
        method: "PATCH",
        body: partial,
      });
      apply(next);
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function addComment() {
    const body = comment.trim();
    if (!body) return;
    setComment("");
    try {
      const { comment: c } = await api<{ comment: SerializedTicket["comments"][number] }>(
        `/api/tickets/${t.id}/comments`,
        { body: { body } },
      );
      const next = { ...t, comments: [...t.comments, c], commentCount: t.commentCount + 1 };
      apply(next);
    } catch (e) {
      toast({ title: "Couldn't comment", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  async function remove() {
    if (!confirm("Delete this ticket?")) return;
    try {
      await api(`/api/tickets/${t.id}`, { method: "DELETE" });
      onDeleted(t.id);
    } catch (e) {
      toast({ title: "Couldn't delete", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  function setDueIn(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(12, 0, 0, 0);
    patch({ dueDate: d.toISOString() });
  }

  async function moveToDone() {
    if (!onMoveToDone || !doneColumn || isDone) return;
    setSaving(true);
    try {
      const next = await onMoveToDone();
      apply(next);
    } catch (e) {
      toast({ title: "Couldn't mark done", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    // Flush an in-progress title edit (saved on blur only) so Escape/backdrop
    // close doesn't silently discard it.
    const trimmed = title.trim();
    if (trimmed && trimmed !== t.title) patch({ title: trimmed });
    onClose();
  }

  const column = columns.find((c) => c.id === t.columnId);
  const doneColumn = columns.find((c) => c.isDone);
  const isDone = Boolean(column?.isDone);
  const pr = priorityMeta(t.priority);
  const due = dueMeta(t.dueDate);
  const dueValue = t.dueDate ? t.dueDate.slice(0, 10) : "";

  const labelIds = new Set(t.labels.map((l) => l.id));
  function toggleLabel(id: string) {
    const next = new Set(labelIds);
    next.has(id) ? next.delete(id) : next.add(id);
    patch({ labelIds: [...next] });
  }

  // Assignable humans: everyone the board is shared with; make sure the
  // current user always appears (solo workspaces pass no members list).
  const assignableUsers: MemberLite[] = React.useMemo(() => {
    const list = [...members];
    if (currentUser && !list.some((m) => m.id === currentUser.id)) list.unshift(currentUser);
    return list;
  }, [members, currentUser]);

  return (
    <Modal open onClose={handleClose} size="lg" hideClose>
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-1.5">
        <Menu
          trigger={
            <button className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-surface-3 cursor-pointer">
              <Columns3 className="h-3.5 w-3.5" />
              {column?.name ?? "Column"}
              {t.subState ? ` · ${t.subState}` : ""}
            </button>
          }
        >
          {(close) => (
            <div className="max-h-[60vh] min-w-[11rem] overflow-y-auto py-1">
              {columns.map((c) =>
                c.subStates.length === 0 ? (
                  <MenuItem
                    key={c.id}
                    active={c.id === t.columnId}
                    onClick={() => {
                      close();
                      if (c.id !== t.columnId || t.subState) patch({ columnId: c.id, subState: null });
                    }}
                  >
                    {c.name}
                  </MenuItem>
                ) : (
                  <div key={c.id}>
                    <div className="px-2.5 pb-0.5 pt-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                      {c.name}
                    </div>
                    {c.subStates.map((s) => (
                      <MenuItem
                        key={c.id + s}
                        active={c.id === t.columnId && t.subState === s}
                        onClick={() => {
                          close();
                          patch({ columnId: c.id, subState: s });
                        }}
                      >
                        <span className="pl-1.5">{s}</span>
                      </MenuItem>
                    ))}
                  </div>
                ),
              )}
            </div>
          )}
        </Menu>
          {onMoveToDone && (
            <button
              onClick={moveToDone}
              disabled={!doneColumn || isDone || saving}
              title={!doneColumn ? "No done column configured" : isDone ? "Already in the done column" : `Move to ${doneColumn.name}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                isDone
                  ? "bg-success-soft text-success cursor-default"
                  : doneColumn
                    ? "bg-success text-success-fg shadow-sm hover:bg-success/90 cursor-pointer"
                    : "bg-surface-2 text-fg-subtle cursor-not-allowed opacity-60",
              )}
            >
              <CircleCheck className="h-3.5 w-3.5" />
              {isDone ? "Done" : "Mark done"}
            </button>
          )}
          {t.number != null && (
            <span className="text-xs font-medium text-fg-subtle">#{t.number}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {saving && <span className="text-[0.6875rem] text-fg-subtle">Saving…</span>}
          <button
            onClick={remove}
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger transition-colors cursor-pointer"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={handleClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* Title — dir="auto" keeps RTL-first titles (Hebrew/Arabic) reading correctly while editing */}
      <textarea
        dir="auto"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== t.title && patch({ title: title.trim() })}
        rows={1}
        className="w-full resize-none bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-fg-subtle"
        placeholder="Ticket title"
      />

      {t.sourceNoteId && (
        <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-subtle">
          <NotebookPen className="h-3.5 w-3.5" /> Sorted from a captured note
        </div>
      )}

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Priority */}
        <Menu
          trigger={
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 cursor-pointer">
              <Flag className="h-3.5 w-3.5" style={{ color: pr.color }} />
              {pr.label}
            </button>
          }
        >
          {(close) =>
            PRIORITIES.map((p) => (
              <MenuItem
                key={p}
                active={p === t.priority}
                onClick={() => {
                  close();
                  patch({ priority: p });
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_META[p].color }} />
                {PRIORITY_META[p].label}
              </MenuItem>
            ))
          }
        </Menu>

        {/* Due date */}
        <Menu
          trigger={
            <button
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 cursor-pointer",
                due?.tone === "rose" ? "border-danger/40 text-danger" : "border-border",
              )}
            >
              <CalendarClock className="h-3.5 w-3.5 text-fg-muted" />
              {due ? due.label : <span className="text-fg-muted">Due date</span>}
            </button>
          }
        >
          {(close) => (
            <>
              <MenuItem onClick={() => { close(); setDueIn(0); }}>Today</MenuItem>
              <MenuItem onClick={() => { close(); setDueIn(1); }}>Tomorrow</MenuItem>
              <MenuItem onClick={() => { close(); setDueIn(7); }}>In a week</MenuItem>
              <div className="px-1.5 py-1.5">
                <input
                  type="date"
                  value={dueValue}
                  onChange={(e) => {
                    patch({ dueDate: e.target.value ? new Date(e.target.value + "T12:00:00").toISOString() : null });
                    close();
                  }}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              {t.dueDate && (
                <MenuItem className="text-danger hover:bg-danger-soft" onClick={() => { close(); patch({ dueDate: null }); }}>
                  Clear due date
                </MenuItem>
              )}
            </>
          )}
        </Menu>

        {/* Assignee */}
        <Menu
          trigger={
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 cursor-pointer">
              {t.assignee ? (
                <>
                  <Avatar
                    name={t.assignee.name}
                    color={t.assignee.type === "agent" ? t.assignee.color : undefined}
                    isAgent={t.assignee.type === "agent"}
                    size={16}
                  />
                  {t.assignee.name}
                </>
              ) : (
                <span className="text-fg-muted">Assign</span>
              )}
            </button>
          }
        >
          {(close) => (
            <>
              <MenuItem
                active={!t.assignee}
                onClick={() => {
                  close();
                  patch({ assigneeType: null });
                }}
              >
                Unassigned
              </MenuItem>
              {assignableUsers.map((m) => (
                <MenuItem
                  key={m.id}
                  active={t.assignee?.type === "user" && t.assignee.id === m.id}
                  onClick={() => {
                    close();
                    patch({ assigneeType: "user", assigneeUserId: m.id });
                  }}
                >
                  <Avatar name={m.name} size={16} />
                  {m.name}
                  {m.id === currentUser?.id && <span className="text-[0.625rem] text-fg-subtle">you</span>}
                </MenuItem>
              ))}
              {agents.map((a) => (
                <MenuItem
                  key={a.id}
                  active={t.assignee?.type === "agent" && t.assignee.id === a.id}
                  onClick={() => {
                    close();
                    patch({ assigneeType: "agent", assigneeAgentId: a.id });
                  }}
                >
                  <Avatar name={a.name} color={a.color} isAgent size={16} />
                  {a.name}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <Tag className="h-3.5 w-3.5" /> Labels
          </div>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => {
              const on = labelIds.has(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => toggleLabel(l.id)}
                  className={cn("transition-opacity cursor-pointer", on ? "opacity-100" : "opacity-45 hover:opacity-80")}
                >
                  <Badge tone={l.color} dot>
                    {l.name}
                    {on && <Check className="h-3 w-3" />}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-fg-muted">Description</div>
        {editingDesc ? (
          <RichEditor
            value={desc}
            onSave={(html) => {
              setEditingDesc(false);
              if (html !== t.description) patch({ description: html });
            }}
            onCancel={() => setEditingDesc(false)}
          />
        ) : t.description ? (
          <div
            className="cursor-text rounded-xl border border-transparent px-3 py-2 text-sm transition-colors hover:border-border hover:bg-surface-2/40"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              setDesc(t.description);
              setEditingDesc(true);
            }}
          >
            <RichText html={t.description} />
          </div>
        ) : (
          <button
            onClick={() => {
              setDesc("");
              setEditingDesc(true);
            }}
            className="w-full rounded-xl border border-dashed border-border px-3 py-3 text-left text-sm text-fg-subtle transition-colors hover:border-primary hover:text-fg-muted cursor-text"
          >
            Add a description…
          </button>
        )}
      </div>

      {/* Subtasks */}
      <SubtasksSection ticket={t} onTicket={apply} />

      {/* Comments / activity */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-medium text-fg-muted">
          Comments {t.comments.length > 0 && `(${t.comments.length})`}
        </div>
        <div className="space-y-3">
          {t.comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.authorName} isAgent={c.authorType === "agent"} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold">{c.authorName}</span>
                  {c.authorType === "agent" && <Badge tone="iris">agent</Badge>}
                  <span suppressHydrationWarning className="text-[0.6875rem] text-fg-subtle">
                    {timeAgo(c.createdAt)}
                  </span>
                </div>
                <p dir="auto" className="mt-0.5 whitespace-pre-wrap text-sm text-fg leading-relaxed">{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-end gap-2">
          <textarea
            dir="auto"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                addComment();
              }
            }}
            rows={1}
            placeholder="Write a comment…"
            className="min-h-9.5 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <Button variant="primary" size="icon" onClick={addComment} disabled={!comment.trim()} aria-label="Send">
            <CornerDownLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SubtasksSection({
  ticket: t,
  onTicket,
}: {
  ticket: SerializedTicket;
  onTicket: (next: SerializedTicket) => void;
}) {
  const { toast } = useToast();
  const [newTitle, setNewTitle] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const subtasks = t.subtasks;
  const done = subtasks.filter((s) => s.completed).length;

  async function call(path: string, options?: { method?: string; body?: unknown }) {
    setBusy(true);
    try {
      const { ticket: next } = await api<{ ticket: SerializedTicket }>(path, options);
      onTicket(next);
    } catch (e) {
      toast({ title: "Couldn't update subtasks", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const title = newTitle.trim();
    if (!title || busy) return;
    setNewTitle("");
    await call(`/api/tickets/${t.id}/subtasks`, { body: { title } });
  }

  function toggle(id: string, completed: boolean) {
    void call(`/api/tickets/${t.id}/subtasks/${id}`, { method: "PATCH", body: { completed } });
  }

  function saveTitle(id: string) {
    const title = editTitle.trim();
    setEditingId(null);
    const current = subtasks.find((s) => s.id === id);
    if (!title || !current || title === current.title) return;
    void call(`/api/tickets/${t.id}/subtasks/${id}`, { method: "PATCH", body: { title } });
  }

  function remove(id: string) {
    void call(`/api/tickets/${t.id}/subtasks/${id}`, { method: "DELETE" });
  }

  function move(id: string, dir: -1 | 1) {
    const ids = subtasks.map((s) => s.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void call(`/api/tickets/${t.id}/subtasks/reorder`, { body: { orderedIds: ids } });
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <ListChecks className="h-3.5 w-3.5" /> Subtasks
        {subtasks.length > 0 && (
          <span className="text-fg-subtle">
            {done}/{subtasks.length}
          </span>
        )}
      </div>

      {subtasks.length > 0 && (
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${Math.round((done / subtasks.length) * 100)}%` }}
          />
        </div>
      )}

      <div className="space-y-1">
        {subtasks.map((s, i) => (
          <div
            key={s.id}
            dir="auto"
            className="group flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition-colors hover:border-border hover:bg-surface-2/40"
          >
            <button
              onClick={() => toggle(s.id, !s.completed)}
              disabled={busy}
              aria-label={s.completed ? "Mark incomplete" : "Mark complete"}
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors cursor-pointer",
                s.completed
                  ? "border-success bg-success text-success-fg"
                  : "border-border hover:border-success",
              )}
            >
              {s.completed && <Check className="h-3.5 w-3.5" />}
            </button>

            {editingId === s.id ? (
              <input
                dir="auto"
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => saveTitle(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle(s.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-0.5 text-sm outline-none focus:border-primary"
              />
            ) : (
              <button
                dir="auto"
                onClick={() => {
                  setEditingId(s.id);
                  setEditTitle(s.title);
                }}
                className={cn(
                  "min-w-0 flex-1 truncate text-left text-sm cursor-text",
                  s.completed ? "text-fg-subtle line-through" : "text-fg",
                )}
              >
                {s.title}
              </button>
            )}

            <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => move(s.id, -1)}
                disabled={busy || i === 0}
                aria-label="Move up"
                className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-30 cursor-pointer"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => move(s.id, 1)}
                disabled={busy || i === subtasks.length - 1}
                aria-label="Move down"
                className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-30 cursor-pointer"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => remove(s.id)}
                disabled={busy}
                aria-label="Delete subtask"
                className="grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <input
          dir="auto"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a subtask…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-fg-subtle focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <Button variant="secondary" size="icon" onClick={add} disabled={!newTitle.trim() || busy} aria-label="Add subtask">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
