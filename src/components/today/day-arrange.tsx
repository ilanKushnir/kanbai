"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Clock3, GripVertical, Moon, Sun, SunMoon, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_PARTS, DAY_PART_LABEL, dropInto, type DayPart, type PlanEntry, type Slot } from "@/lib/day-plan";
import type { TaskItem } from "@/lib/today-model";

/**
 * Arranging Today and Tomorrow by hand: drag a task to where it belongs, and
 * (optionally) see the day split into Morning / Afternoon / Evening.
 *
 *   mouse  — press anywhere on a row and move
 *   touch  — hold a row for a moment, then move (a quick swipe still scrolls)
 *
 * The drop point is read from the rows on screen (`[data-slot]`), and the
 * dragged row stays mounted (only hidden): iOS stops delivering a touch whose
 * target left the page.
 */

export type ArrangeKey = "today" | "tomorrow";

// ── Split preference (per device, per section) ───────────────────────────────

const SPLIT_KEY = "kanbai:day-split";
const splitListeners = new Set<() => void>();

export function useDaySplit() {
  const raw = React.useSyncExternalStore(
    (cb) => {
      splitListeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        splitListeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(SPLIT_KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const prefs = React.useMemo<Partial<Record<ArrangeKey, boolean>>>(() => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [raw]);
  const toggle = React.useCallback(
    (key: ArrangeKey) => {
      try {
        localStorage.setItem(SPLIT_KEY, JSON.stringify({ ...prefs, [key]: !prefs[key] }));
      } catch {}
      for (const l of splitListeners) l();
    },
    [prefs],
  );
  return { isSplit: (key: ArrangeKey) => !!prefs[key], toggle };
}

export function SplitToggle({ on, onClick, className }: { on: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? "Hide morning, afternoon and evening" : "Split by morning, afternoon and evening"}
      title={on ? "Hide the time of day" : "Split by time of day"}
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer",
        on ? "bg-surface-2 text-fg ring-1 ring-border-strong" : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      <SunMoon className="h-4 w-4" />
    </button>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

export const PART_ICON: Record<DayPart, typeof Sun> = { morning: Sunrise, afternoon: Sun, evening: Moon };

const LONG_PRESS_MS = 260;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 5;
const EDGE = 44;
const FINGER_GAP = 28;

type Drag = { id: string; before: string | null; height: number; width: number; touch: boolean; title: string };

/** Elements a drag never starts from: the check, the row's buttons, anything you type in. */
const NO_DRAG = "[data-no-drag], textarea, input, select";

export function ArrangeList({
  items,
  split,
  nowPart,
  renderRow,
  onArrange,
}: {
  /** In display order, each with its part (see buildToday). */
  items: TaskItem[];
  split: boolean;
  /** Today only: the part of the day it is now, marked on its divider. */
  nowPart?: DayPart | null;
  renderRow: (item: TaskItem) => React.ReactNode;
  /** The section's new order, after a drop. */
  onArrange: (entries: PlanEntry[]) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const ghostRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const live = React.useRef<{ drag: Drag; x: number; y: number; y0: number; offY: number; scroller: HTMLElement | null; raf: number } | null>(null);
  const latest = React.useRef({ items, split, onArrange });
  React.useEffect(() => {
    latest.current = { items, split, onArrange };
  });

  // iOS lets a touchmove be cancelled only if a non-passive listener was there first.
  React.useEffect(() => {
    const noop = () => {};
    window.addEventListener("touchmove", noop, { passive: false });
    return () => window.removeEventListener("touchmove", noop);
  }, []);

  /** The section top to bottom, without the dragged row. */
  const slotsWithout = (id: string): Slot[] => {
    const { items: list, split: s } = latest.current;
    const rows = list.filter((it) => it.id !== id).map((it): Slot => ({ kind: "item", id: it.id, part: it.part ?? null }));
    if (!s) return rows;
    const out: Slot[] = rows.filter((r) => r.kind === "item" && r.part === null);
    for (const p of DAY_PARTS) {
      out.push({ kind: "part", part: p });
      out.push(...rows.filter((r) => r.kind === "item" && r.part === p));
    }
    return out;
  };

  const placeGhost = () => {
    const s = live.current;
    const g = ghostRef.current;
    if (!s || !g) return;
    const left = Math.min(Math.max(s.x - (s.drag.touch ? g.offsetWidth / 2 : 24), 8), window.innerWidth - g.offsetWidth - 8);
    const top = s.drag.touch ? s.y - g.offsetHeight - FINGER_GAP : s.y - s.offY;
    g.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };

  const hit = (y: number, id: string): string | null => {
    const els = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-slot]")) : [];
    for (const el of els) {
      const key = el.dataset.slot!;
      if (key === id) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return key;
    }
    return null;
  };

  const track = (x: number, y: number) => {
    const s = live.current;
    if (!s) return;
    s.x = x;
    s.y = y;
    placeGhost();
    const before = hit(y, s.drag.id);
    if (before !== s.drag.before) {
      s.drag = { ...s.drag, before };
      setDrag(s.drag);
    }
  };

  const begin = (item: TaskItem, el: HTMLElement, x: number, y: number, touch: boolean) => {
    const r = el.getBoundingClientRect();
    const d: Drag = { id: item.id, before: null, height: r.height, width: r.width, touch, title: item.title.split("\n")[0] };
    const s = { drag: d, x, y, y0: y, offY: y - r.top, scroller: el.closest("main") as HTMLElement | null, raf: 0 };
    live.current = s;
    // Start where it was: the slot right after it.
    const order = slotsWithout("");
    const at = order.findIndex((o) => o.kind === "item" && o.id === item.id);
    const next = order[at + 1];
    d.before = next ? (next.kind === "item" ? next.id : `part:${next.part}`) : null;
    document.documentElement.classList.add("kb-arranging");
    setDrag(d);
    try {
      if (touch) navigator.vibrate?.(8);
    } catch {}
    const loop = () => {
      if (live.current !== s) return;
      const sc = s.scroller;
      if (sc && Math.abs(s.y - s.y0) > 24) {
        const b = sc.getBoundingClientRect();
        const v = s.y < b.top + EDGE ? -(b.top + EDGE - s.y) / 3 : s.y > b.bottom - EDGE ? (s.y - (b.bottom - EDGE)) / 3 : 0;
        if (v) {
          const before = sc.scrollTop;
          sc.scrollTop += Math.round(v);
          if (sc.scrollTop !== before) track(s.x, s.y);
        }
      }
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
  };

  const finish = (drop: boolean) => {
    const s = live.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    live.current = null;
    document.documentElement.classList.remove("kb-arranging");
    setDrag(null);
    if (drop) {
      const { split: sp, onArrange: done } = latest.current;
      done(dropInto(slotsWithout(s.drag.id), s.drag.id, s.drag.before, sp));
    }
    // The release would also click whatever is under it.
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", stop, true);
    setTimeout(() => window.removeEventListener("click", stop, true), 0);
  };

  const source = (item: TaskItem) => ({
    "data-drag": "",
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0 || live.current || (e.target as Element).closest(NO_DRAG)) return;
      const el = e.currentTarget;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const move = (ev: MouseEvent) => {
        if (!live.current) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < MOUSE_SLOP) return;
          begin(item, el, x0, y0, false);
        }
        track(ev.clientX, ev.clientY);
      };
      const up = () => {
        cleanup();
        finish(true);
      };
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        cleanup();
        finish(false);
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("keydown", key);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      window.addEventListener("keydown", key);
    },
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (e.touches.length !== 1 || live.current || (e.target as Element).closest(NO_DRAG)) return;
      const el = e.currentTarget;
      const x0 = e.touches[0].clientX;
      const y0 = e.touches[0].clientY;
      const timer = setTimeout(() => {
        begin(item, el, x0, y0, true);
        track(x0, y0);
      }, LONG_PRESS_MS);
      const move = (ev: TouchEvent) => {
        const p = ev.touches[0];
        if (!p) return;
        if (!live.current) {
          // Moved before the hold: a scroll, not a drag.
          if (Math.hypot(p.clientX - x0, p.clientY - y0) > TOUCH_SLOP) {
            clearTimeout(timer);
            cleanup();
          }
          return;
        }
        ev.preventDefault();
        track(p.clientX, p.clientY);
      };
      const end = (ev: TouchEvent) => {
        clearTimeout(timer);
        cleanup();
        if (!live.current) return;
        ev.preventDefault();
        finish(ev.type === "touchend");
      };
      const cleanup = () => {
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", end);
        window.removeEventListener("touchcancel", end);
      };
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", end, { passive: false });
      window.addEventListener("touchcancel", end);
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (live.current || (e.nativeEvent as PointerEvent).pointerType === "touch") e.preventDefault();
    },
  });

  // Unmounting mid-drag (the section closed, focus toggled) must not leave the page "grabbing".
  React.useEffect(() => () => document.documentElement.classList.remove("kb-arranging"), []);

  const placeholder = drag && (
    <div key="__placeholder" aria-hidden className="kb-arrange-gap my-0.5 rounded-xl border border-dashed border-border-strong bg-surface-2/60" style={{ height: drag.height }} />
  );

  // What the list reads, top to bottom: rows (and dividers when split), the gap where the drag would land.
  const nodes: React.ReactNode[] = [];
  const pushRow = (it: TaskItem) => {
    if (drag && drag.before === it.id) nodes.push(placeholder);
    nodes.push(
      <div key={it.id} data-slot={it.id} className={cn("group/arr relative", drag?.id === it.id && "hidden")} {...source(it)}>
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-3 -left-1 text-fg-subtle/60 opacity-0 transition-opacity group-hover/arr:opacity-100",
            split && "[@media(hover:none)]:opacity-60",
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {renderRow(it)}
      </div>,
    );
  };

  if (!split) {
    items.forEach(pushRow);
  } else {
    const anytime = items.filter((it) => !it.part);
    // Until something has a part, one line says how this works.
    if (!drag && anytime.length === items.length) {
      nodes.push(
        <p key="hint" className="px-3 pt-1 pb-0.5 text-xs text-fg-subtle">
          <span className="[@media(hover:none)]:hidden">Drag a task to the part of the day you&apos;ll do it.</span>
          <span className="hidden [@media(hover:none)]:inline">Hold a task, then drag it to the part of the day you&apos;ll do it.</span>
        </p>,
      );
    }
    if (anytime.length || drag) nodes.push(<PartHead key="head:anytime" label="Anytime" icon={Clock3} count={anytime.length} />);
    anytime.forEach(pushRow);
    for (const p of DAY_PARTS) {
      const mine = items.filter((it) => it.part === p);
      if (drag && drag.before === `part:${p}`) nodes.push(placeholder);
      nodes.push(
        <div key={`part:${p}`} data-slot={`part:${p}`}>
          <PartHead label={DAY_PART_LABEL[p]} icon={PART_ICON[p]} count={mine.filter((it) => it.id !== drag?.id).length} now={nowPart === p} />
        </div>,
      );
      mine.forEach(pushRow);
    }
  }
  if (drag && drag.before === null) nodes.push(placeholder);

  return (
    <div ref={listRef}>
      {nodes}
      {drag &&
        createPortal(
          <div ref={(el) => { ghostRef.current = el; placeGhost(); }} className="pointer-events-none fixed top-0 left-0 z-[70]" style={{ width: Math.min(Math.max(drag.width, 220), 420) }}>
            <div className="kb-drag-lift flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-lg">
              <span className="h-[1.125rem] w-[1.125rem] shrink-0 rounded-full border-[1.5px] border-border-strong" />
              <span className="truncate text-[0.95rem] text-fg" dir="auto">{drag.title}</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function PartHead({ label, icon: Icon, count, now }: { label: string; icon: typeof Sun; count: number; now?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
      <Icon className={cn("h-3.5 w-3.5", now ? "text-fg" : "text-fg-subtle")} />
      <span className={cn("text-[0.6875rem] font-semibold uppercase tracking-wider", now ? "text-fg" : "text-fg-subtle")}>{label}</span>
      {count > 0 && <span className="text-[0.6875rem] tabular-nums text-fg-subtle">{count}</span>}
      {now && <span className="rounded-full bg-primary px-1.5 py-px text-[0.5625rem] font-semibold uppercase tracking-wider text-primary-fg">Now</span>}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
