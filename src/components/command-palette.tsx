"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  NotebookPen,
  Columns3,
  Bot,
  SunMoon,
  CornerDownLeft,
  Hash,
  ArrowRight,
} from "lucide-react";
import { tone } from "@/components/ui/badge";
import { priorityMeta } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { NavBoard } from "@/components/app-shell";

type SearchResults = {
  boards: { id: string; name: string; slug: string; color: string }[];
  tickets: { id: string; title: string; priority: string; boardSlug: string; boardName: string; column: string }[];
  notes: { id: string; body: string; status: string }[];
};

type Item = {
  key: string;
  group: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  hint?: string;
  onSelect: () => void;
};

const GROUP_ORDER = ["Actions", "Go to", "Boards", "Tickets", "Notes"];

export function CommandPalette({
  open,
  onClose,
  boards,
}: {
  open: boolean;
  onClose: () => void;
  boards: NavBoard[];
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          setResults(await res.json());
          setActive(0); // realign highlight with the freshly-loaded result order
        }
      } catch {
        /* ignore */
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const run = React.useCallback(
    (fn: () => void) => {
      fn();
      onClose();
    },
    [onClose],
  );

  function toggleTheme() {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("kanbai-theme", dark ? "dark" : "light");
    } catch {}
  }

  const items: Item[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];

    // Actions (always available; filtered by query substring)
    const actions: Item[] = [
      {
        key: "a-note",
        group: "Actions",
        label: "New note",
        icon: <Plus className="h-4 w-4" />,
        hint: "C",
        onSelect: () => run(() => router.push("/notes?compose=1")),
      },
      {
        key: "a-board",
        group: "Actions",
        label: "New board",
        icon: <Plus className="h-4 w-4" />,
        onSelect: () => run(() => router.push("/boards?new=1")),
      },
      {
        key: "a-theme",
        group: "Actions",
        label: "Toggle theme",
        icon: <SunMoon className="h-4 w-4" />,
        onSelect: () => run(toggleTheme),
      },
    ];
    const nav: Item[] = [
      { key: "n-notes", group: "Go to", label: "Notes", icon: <NotebookPen className="h-4 w-4" />, onSelect: () => run(() => router.push("/notes")) },
      { key: "n-boards", group: "Go to", label: "Boards", icon: <Columns3 className="h-4 w-4" />, onSelect: () => run(() => router.push("/boards")) },
      { key: "n-agents", group: "Go to", label: "Agents", icon: <Bot className="h-4 w-4" />, onSelect: () => run(() => router.push("/agents")) },
    ];

    if (!q) {
      out.push(...actions, ...nav);
      boards.forEach((b) =>
        out.push({
          key: `b-${b.id}`,
          group: "Boards",
          label: b.name,
          icon: <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />,
          onSelect: () => run(() => router.push(`/boards/${b.slug}`)),
        }),
      );
      return out;
    }

    out.push(...actions.filter((a) => a.label.toLowerCase().includes(q)));
    out.push(...nav.filter((a) => a.label.toLowerCase().includes(q)));

    if (results) {
      results.boards.forEach((b) =>
        out.push({
          key: `rb-${b.id}`,
          group: "Boards",
          label: b.name,
          icon: <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />,
          onSelect: () => run(() => router.push(`/boards/${b.slug}`)),
        }),
      );
      results.tickets.forEach((t) =>
        out.push({
          key: `rt-${t.id}`,
          group: "Tickets",
          label: t.title,
          sub: `${t.boardName} · ${t.column}`,
          icon: <span className="h-2 w-2 rounded-full" style={{ backgroundColor: priorityMeta(t.priority).color }} />,
          onSelect: () => run(() => router.push(`/boards/${t.boardSlug}?ticket=${t.id}`)),
        }),
      );
      results.notes.forEach((n) =>
        out.push({
          key: `rn-${n.id}`,
          group: "Notes",
          label: n.body,
          icon: <Hash className="h-4 w-4 text-fg-subtle" />,
          onSelect: () => run(() => router.push(`/notes?focus=${n.id}`)),
        }),
      );
    }
    return out;
  }, [query, results, boards, router, run]);

  React.useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[active]?.onSelect();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, items, active, onClose]);

  React.useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  // Render grouped, but keep a flat index aligned with `items` for keyboard nav.
  let flatIndex = -1;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-lg animate-scale-in"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4.5 w-4.5 shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or jump to…  (boards, tickets, notes)"
            className="h-12 w-full bg-transparent text-[0.95rem] outline-none placeholder:text-fg-subtle"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.625rem] text-fg-subtle sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-fg-subtle">No results for “{query}”.</div>
          ) : (
            GROUP_ORDER.filter((g) => items.some((i) => i.group === g)).map((group) => (
              <div key={group} className="mb-1">
                <div className="px-2.5 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                  {group}
                </div>
                {items
                  .filter((i) => i.group === group)
                  .map((item) => {
                    flatIndex++;
                    const idx = flatIndex;
                    const isActive = idx === active;
                    return (
                      <button
                        key={item.key}
                        data-active={isActive}
                        onMouseMove={() => setActive(idx)}
                        onClick={item.onSelect}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer",
                          isActive ? "bg-primary-soft text-primary-soft-fg" : "text-fg hover:bg-surface-2",
                        )}
                      >
                        <span className="grid h-5 w-5 shrink-0 place-items-center">{item.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.sub && <span className="shrink-0 truncate text-xs text-fg-subtle">{item.sub}</span>}
                        {item.hint && (
                          <kbd className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.625rem] text-fg-subtle">
                            {item.hint}
                          </kbd>
                        )}
                        {isActive && !item.sub && !item.hint && (
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary-soft-fg/60" />
                        )}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[0.6875rem] text-fg-subtle">
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> open
          </span>
          <span>↑↓ navigate</span>
          <span className="ml-auto inline-flex items-center gap-1">
            <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5">⌘K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
