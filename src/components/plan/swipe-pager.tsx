"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type PagerHandle = { go: (dir: -1 | 1) => void };

/** Space between pages while they slide. */
const GAP = 16;
const SETTLE_MS = 360;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** A drag past this share of the width, or a flick faster than FLICK px/ms, turns the page. */
const TURN_RATIO = 0.2;
const FLICK = 0.45;
/** Movement before the gesture picks an axis — under it a touch is still a tap or a long-press. */
const SLOP = 10;

type Gesture = { id: number; x0: number; y0: number; lastX: number; lastT: number; v: number; axis: "x" | "y" | null };

/**
 * Three pages side by side — previous, current, next. On touch the current
 * page follows the finger and a swipe eases the neighbour in; the arrows and
 * a sideways trackpad swipe use the same motion. Vertical scrolling stays the
 * browser's. Neighbours are pictures only (inert); `onShift` commits the move
 * once the slide has landed, so the new current page replaces an identical
 * picture without a flicker.
 */
export function SwipePager({
  render,
  onShift,
  disabled,
  className,
  ref,
}: {
  render: (offset: -1 | 0 | 1) => React.ReactNode;
  onShift: (dir: -1 | 1) => void;
  /** While true (e.g. a card is being dragged) touches never turn the page. */
  disabled?: boolean;
  className?: string;
  ref?: React.Ref<PagerHandle>;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const pages = React.useRef<Record<-1 | 1, HTMLDivElement | null>>({ [-1]: null, 1: null });
  const [x, setX] = React.useState(0);
  const [settling, setSettling] = React.useState(false);
  const busy = React.useRef(false);
  const gesture = React.useRef<Gesture | null>(null);
  const swiped = React.useRef(false);
  const latest = React.useRef({ onShift, disabled });
  React.useEffect(() => {
    latest.current = { onShift, disabled };
  });

  const settle = React.useCallback((dir: -1 | 0 | 1) => {
    const el = box.current;
    if (!el) return;
    busy.current = true;
    // Ease the height too when the next page is taller or shorter (5 vs 6 weeks).
    const target = dir ? pages.current[dir] : null;
    if (target && target.offsetHeight !== el.offsetHeight) {
      el.style.height = `${el.offsetHeight}px`;
      void el.offsetHeight;
      el.style.transition = `height ${SETTLE_MS}ms ${EASE}`;
      el.style.height = `${target.offsetHeight}px`;
    }
    setSettling(true);
    setX(-dir * (el.clientWidth + GAP));
    window.setTimeout(() => {
      if (dir) latest.current.onShift(dir);
      setSettling(false);
      setX(0);
      el.style.height = "";
      el.style.transition = "";
      busy.current = false;
    }, SETTLE_MS);
  }, []);

  React.useImperativeHandle(ref, () => ({ go: (dir) => !busy.current && settle(dir) }), [settle]);

  // Sideways trackpad swipes (and shift + wheel): one page per gesture.
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    let acc = 0;
    let locked = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault(); // no history swipe
      acc += e.deltaX;
      clearTimeout(idle);
      // Momentum keeps sending events; the gesture ends when they stop.
      idle = setTimeout(() => {
        acc = 0;
        locked = false;
      }, 160);
      if (!locked && !busy.current && Math.abs(acc) > 50) {
        locked = true;
        settle(acc > 0 ? 1 : -1);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(idle);
    };
  }, [settle]);

  const onPointerDown = (e: React.PointerEvent) => {
    swiped.current = false;
    if (e.pointerType === "mouse" || busy.current || disabled) return;
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp, v: 0, axis: null };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    if (latest.current.disabled) {
      // A long-press lifted a card: the touch belongs to the drag now.
      gesture.current = null;
      if (g.axis === "x") settle(0);
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.axis) {
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.axis = "x";
        swiped.current = true;
        box.current?.setPointerCapture(e.pointerId);
      } else if (Math.abs(dy) > SLOP) {
        gesture.current = null;
        return;
      } else return;
    }
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.v = 0.7 * ((e.clientX - g.lastX) / dt) + 0.3 * g.v;
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;
    setX(dx);
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (g.axis !== "x") return;
    const dx = e.clientX - g.x0;
    const w = box.current?.clientWidth ?? 1;
    // A release that has stopped moving counts only the distance.
    const v = e.timeStamp - g.lastT > 80 ? 0 : g.v;
    const turn = (dx < -w * TURN_RATIO && v <= FLICK) || v < -FLICK ? 1 : (dx > w * TURN_RATIO && v >= -FLICK) || v > FLICK ? -1 : 0;
    settle(e.type === "pointercancel" ? 0 : turn);
  };

  const moving = x !== 0 || settling;
  return (
    <div
      ref={box}
      className={cn("relative touch-pan-y overflow-hidden", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        // The finger lifting after a swipe isn't a tap on a day.
        if (swiped.current) {
          e.stopPropagation();
          swiped.current = false;
        }
      }}
    >
      <div
        className="relative"
        style={{
          transform: moving ? `translate3d(${x}px,0,0)` : undefined,
          transition: settling ? `transform ${SETTLE_MS}ms ${EASE}` : "none",
          willChange: moving ? "transform" : undefined,
        }}
      >
        {([-1, 1] as const).map((o) => (
          <div
            key={o}
            ref={(el) => {
              pages.current[o] = el;
            }}
            aria-hidden
            inert
            className="pointer-events-none absolute top-0 w-full"
            style={o < 0 ? { right: `calc(100% + ${GAP}px)` } : { left: `calc(100% + ${GAP}px)` }}
          >
            {render(o)}
          </div>
        ))}
        {render(0)}
      </div>
    </div>
  );
}
