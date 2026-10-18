"use client";

import * as React from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { subtaskProgress, type SubtaskItem } from "@/lib/subtask-list";

/**
 * Subtasks on a task row: a small progress ring that opens the checklist
 * under the title, hung from a thin guide line; and the question asked when
 * a task is completed with parts of it still open. Shared by Today, Focus and
 * Plan, for simple tasks and tickets alike.
 */

export type SubtaskEdit =
  | { type: "toggle"; id: string; completed: boolean }
  | { type: "add"; title: string }
  | { type: "rename"; id: string; title: string }
  | { type: "delete"; id: string };

/** The ring: fills as subtasks get done, turns into a check when all are. */
export function SubtaskRing({ done, total, className }: { done: number; total: number; className?: string }) {
  const r = 5.25;
  const c = 2 * Math.PI * r;
  const all = total > 0 && done === total;
  return (
    <svg viewBox="0 0 14 14" className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="1.75" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill={all ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (total ? done / total : 0))}
        transform="rotate(-90 7 7)"
        style={{ transition: "stroke-dashoffset 300ms cubic-bezier(0.2, 0, 0, 1), fill 150ms" }}
      />
      {all && <path d="M4.4 7.1 6.2 8.8 9.6 5.3" fill="none" stroke="var(--color-surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** "◔ 1/3 ⌄" — tells the row has parts, and opens them. */
export function SubtaskToggle({ items, open, onClick }: { items: SubtaskItem[]; open: boolean; onClick: () => void }) {
  const { done, total } = subtaskProgress(items);
  return (
    <button
      type="button"
      data-no-drag
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${done} of ${total} subtasks done — ${open ? "hide" : "show"}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-px tabular-nums transition-colors duration-150 cursor-pointer",
        done === total ? "text-success" : "text-fg-muted",
        open ? "bg-surface-3" : "hover:bg-surface-2",
      )}
    >
      <SubtaskRing done={done} total={total} />
      {done}/{total}
      <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", open && "rotate-180")} />
    </button>
  );
}

/** The checklist itself. Each new `autoAdd` value (a counter) opens the add field. */
export function SubtaskList({
  items,
  open,
  onEdit,
  autoAdd,
  readOnly,
}: {
  items: SubtaskItem[];
  open: boolean;
  onEdit: (e: SubtaskEdit) => void;
  autoAdd?: number;
  readOnly?: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [seenAuto, setSeenAuto] = React.useState(autoAdd);
  if (autoAdd !== seenAuto) {
    setSeenAuto(autoAdd);
    if (autoAdd) setAdding(true);
  }

  function add() {
    const t = draft.trim();
    if (!t) return;
    onEdit({ type: "add", title: t });
    setDraft("");
  }

  return (
    <div className={cn("grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.2,0,0,1)]", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!open}>
      <div className="min-h-0 overflow-hidden">
        <ul className="kb-subtasks mt-1.5 mb-0.5 ms-0.5 space-y-px border-s border-border ps-2.5" data-no-drag>
          {items.map((s) => (
            <SubtaskRow key={s.id} item={s} onEdit={onEdit} readOnly={readOnly} />
          ))}
          {!readOnly &&
            (adding ? (
              <li className="flex items-center gap-2 py-0.5">
                <span className="kb-subcheck opacity-50" aria-hidden />
                <input
                  autoFocus
                  dir="auto"
                  value={draft}
                  maxLength={200}
                  placeholder="Add a subtask…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      add();
                    }
                    if (e.key === "Escape") {
                      setDraft("");
                      setAdding(false);
                    }
                  }}
                  onBlur={() => {
                    add();
                    setAdding(false);
                  }}
                  className="min-w-0 flex-1 bg-transparent py-0.5 text-[0.875rem] text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:outline-none"
                />
              </li>
            ) : (
              <li>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-2 rounded-md py-1 pe-2 text-[0.8125rem] text-fg-subtle transition-colors duration-150 hover:text-fg cursor-pointer"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a subtask
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function SubtaskRow({ item, onEdit, readOnly }: { item: SubtaskItem; onEdit: (e: SubtaskEdit) => void; readOnly?: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.title);
  return (
    <li className="group/sub flex items-start gap-2 rounded-md py-0.5">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onEdit({ type: "toggle", id: item.id, completed: !item.completed })}
        aria-label={item.completed ? `Mark “${item.title}” not done` : `Mark “${item.title}” done`}
        data-checked={item.completed}
        className="kb-subcheck mt-[0.2rem] cursor-pointer disabled:cursor-default"
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
      </button>
      {editing ? (
        <input
          autoFocus
          dir="auto"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(item.title);
              setEditing(false);
            }
          }}
          onBlur={() => {
            setEditing(false);
            const t = draft.trim();
            if (t && t !== item.title) onEdit({ type: "rename", id: item.id, title: t });
            else setDraft(item.title);
          }}
          className="min-w-0 flex-1 bg-transparent text-[0.875rem] leading-5 text-fg focus:outline-none focus-visible:outline-none"
        />
      ) : (
        <span
          dir="auto"
          onClick={() => {
            if (readOnly) return;
            setDraft(item.title);
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 text-[0.875rem] leading-5 transition-colors duration-150",
            item.completed ? "text-fg-subtle line-through decoration-fg-subtle/60" : "text-fg",
            !readOnly && "cursor-text",
          )}
        >
          {item.title}
        </span>
      )}
      {!readOnly && !editing && (
        <button
          type="button"
          onClick={() => onEdit({ type: "delete", id: item.id })}
          aria-label={`Delete “${item.title}”`}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-fg-subtle opacity-0 transition-opacity duration-150 hover:text-danger group-hover/sub:opacity-100 focus-visible:opacity-100 max-md:opacity-60 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

// ── "Are you done with all of it?" ───────────────────────────────────────────

export type CompleteChoice = "all" | "only" | null;

type Ask = { title: string; open: SubtaskItem[]; resolve: (c: CompleteChoice) => void };

/**
 * Completing a task with open subtasks asks first: tick them all, finish
 * just the task, or step back. `confirm` resolves with the choice; tasks with
 * nothing open resolve "only" straight away.
 */
export function useCompleteGuard() {
  const [ask, setAsk] = React.useState<Ask | null>(null);

  const confirm = React.useCallback((title: string, subtasks: SubtaskItem[] | undefined): Promise<CompleteChoice> => {
    const open = (subtasks ?? []).filter((s) => !s.completed);
    if (!open.length) return Promise.resolve("only");
    return new Promise((resolve) => setAsk({ title, open, resolve }));
  }, []);

  const answer = (c: CompleteChoice) => {
    ask?.resolve(c);
    setAsk(null);
  };

  const dialog = (
    <Modal open={ask != null} onClose={() => answer(null)} size="sm" hideClose>
      {ask && (
        <div className="px-5 pt-5 pb-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted">
              <SubtaskRing done={0} total={1} className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[1.05rem] font-semibold tracking-tight">
                {ask.open.length === 1 ? "1 subtask is still open" : `${ask.open.length} subtasks are still open`}
              </h2>
              <p className="truncate text-sm text-fg-muted" dir="auto">{ask.title.split("\n")[0]}</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5 rounded-xl bg-surface-2/70 px-3.5 py-3">
            {ask.open.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm text-fg" dir="auto">
                <span className="kb-subcheck mt-[0.2rem]" aria-hidden />
                <span className="min-w-0 flex-1">{s.title}</span>
              </li>
            ))}
            {ask.open.length > 5 && <li className="ps-6 text-xs text-fg-subtle">and {ask.open.length - 5} more</li>}
          </ul>
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => answer("all")}
              className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-fg transition-[background-color,scale] duration-150 hover:bg-primary-hover active:scale-[0.96] cursor-pointer"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} /> Complete everything
            </button>
            <button
              type="button"
              onClick={() => answer("only")}
              className="h-10 rounded-xl border border-border text-sm font-medium text-fg transition-[background-color,scale] duration-150 hover:bg-surface-2 active:scale-[0.96] cursor-pointer"
            >
              Just the task — leave them open
            </button>
            <button type="button" onClick={() => answer(null)} className="h-9 text-sm text-fg-subtle transition-colors duration-150 hover:text-fg cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );

  return { confirm, dialog };
}
