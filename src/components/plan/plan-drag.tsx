"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { TaskItem } from "@/lib/today-model";

/**
 * Drag & drop for Plan. Small on purpose: the ghost follows the real pointer
 * (position: fixed, portaled to <body>), and the drop target is whatever
 * `[data-drop]` element sits under the pointer — read from the page itself,
 * so scrolling containers, sticky headers and transforms can't put the ghost
 * or the drop somewhere else.
 *
 *   mouse  — press and move 5px
 *   touch  — hold still for a moment, then move (a quick swipe still scrolls)
 *
 * Targets: `data-drop="day:YYYY-MM-DD"`, `"tray"`, `"nav:-1" | "nav:1"`.
 */

const LONG_PRESS_MS = 260;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 5;
/** Auto-scroll zone at the scroller's top and bottom edges. */
const EDGE = 44;
/** Touch: the ghost floats this far above the finger, so the day under it stays visible. */
const FINGER_GAP = 36;

export type DragActive = { item: TaskItem; over: string | null; touch: boolean; width: number };

type Live = {
  item: TaskItem;
  x: number;
  y: number;
  y0: number;
  offX: number;
  offY: number;
  over: string | null;
  touch: boolean;
  scroller: HTMLElement | null;
  raf: number;
};

export type PlanDrag = ReturnType<typeof usePlanDrag>;

export function usePlanDrag(onStart: () => void, onDrop: (item: TaskItem, target: string) => void) {
  const [active, setActive] = React.useState<DragActive | null>(null);
  const live = React.useRef<Live | null>(null);
  const ghost = React.useRef<HTMLDivElement | null>(null);
  const handlers = React.useRef({ onStart, onDrop });
  React.useEffect(() => {
    handlers.current = { onStart, onDrop };
  });

  // iOS lets a touchmove be cancelled only if a non-passive listener was
  // already there when the touch began.
  React.useEffect(() => {
    const noop = () => {};
    window.addEventListener("touchmove", noop, { passive: false });
    return () => window.removeEventListener("touchmove", noop);
  }, []);

  const place = React.useCallback(() => {
    const s = live.current;
    const g = ghost.current;
    if (!s || !g) return;
    // Touch: centred over the finger and kept on screen; mouse: held where it was grabbed.
    const left = s.touch ? Math.min(Math.max(s.x - g.offsetWidth / 2, 8), window.innerWidth - g.offsetWidth - 8) : s.x - s.offX;
    const top = s.touch ? s.y - g.offsetHeight - FINGER_GAP : s.y - s.offY;
    g.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }, []);

  const hitTest = (x: number, y: number) => document.elementFromPoint(x, y)?.closest("[data-drop]")?.getAttribute("data-drop") ?? null;

  const track = React.useCallback(
    (x: number, y: number) => {
      const s = live.current;
      if (!s) return;
      s.x = x;
      s.y = y;
      place();
      const over = hitTest(x, y);
      if (over !== s.over) {
        s.over = over;
        setActive((a) => (a ? { ...a, over } : a));
      }
    },
    [place],
  );

  const begin = React.useCallback(
    (item: TaskItem, el: HTMLElement, x: number, y: number, touch: boolean) => {
      const r = el.getBoundingClientRect();
      const s: Live = { item, x, y, y0: y, offX: Math.min(x - r.left, 280), offY: y - r.top, over: hitTest(x, y), touch, scroller: el.closest("main"), raf: 0 };
      live.current = s;
      document.documentElement.classList.add("kb-plan-dragging");
      setActive({ item, over: s.over, touch, width: r.width });
      handlers.current.onStart();
      if (touch) navigator.vibrate?.(8);
      // Edge auto-scroll, once the pointer has travelled (a lift near the edge shouldn't scroll).
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
    },
    [track],
  );

  const finish = React.useCallback((drop: boolean) => {
    const s = live.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    live.current = null;
    document.documentElement.classList.remove("kb-plan-dragging");
    setActive(null);
    if (drop && s.over) handlers.current.onDrop(s.item, s.over);
    // The release would also click whatever is under it.
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", stop, true);
    setTimeout(() => window.removeEventListener("click", stop, true), 0);
  }, []);

  /** Props for anything draggable. Children marked `data-no-drag` (checks, buttons) never start a drag. */
  const source = React.useCallback(
    (item: TaskItem, disabled?: boolean) => {
      if (disabled) return {};
      return {
        "data-drag": "",
        onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
          if (e.button !== 0 || live.current || (e.target as Element).closest("[data-no-drag]")) return;
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
          if (e.touches.length !== 1 || live.current || (e.target as Element).closest("[data-no-drag]")) return;
          const el = e.currentTarget;
          const x0 = e.touches[0].clientX;
          const y0 = e.touches[0].clientY;
          const timer = setTimeout(() => begin(item, el, x0, y0, true), LONG_PRESS_MS);
          const move = (ev: TouchEvent) => {
            const p = ev.touches[0];
            if (!p) return;
            if (!live.current) {
              // Moved before the hold: it's a scroll or a swipe, not a drag.
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
        // Long-press menus (Android) and the iOS callout would fight the hold.
        onContextMenu: (e: React.MouseEvent) => {
          if (live.current || (e.nativeEvent as PointerEvent).pointerType === "touch") e.preventDefault();
        },
      };
    },
    [begin, finish, track],
  );

  const attachGhost = React.useCallback(
    (el: HTMLDivElement | null) => {
      ghost.current = el;
      place();
    },
    [place],
  );

  return { active, source, attachGhost };
}

/** The lifted item, under the pointer. */
export function DragGhost({ active, attach, children }: { active: DragActive | null; attach: (el: HTMLDivElement | null) => void; children: React.ReactNode }) {
  if (!active || typeof document === "undefined") return null;
  return createPortal(
    <div ref={attach} className="pointer-events-none fixed top-0 left-0 z-[70]" style={{ width: Math.min(Math.max(active.width, 200), 288) }}>
      <div className="kb-drag-lift">{children}</div>
    </div>,
    document.body,
  );
}
