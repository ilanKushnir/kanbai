"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Minimal popover menu with click-outside + escape handling. The content
 * renders through a body portal with fixed positioning so it can escape
 * overflow-hidden ancestors (rounded list cards, scroll containers) and
 * stacking contexts — it layers above the z-50 modal.
 */
export function Menu({
  trigger,
  children,
  align = "start",
  className,
  contentClassName,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end";
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<React.CSSProperties | null>(null);
  const close = React.useCallback(() => setOpen(false), []);

  // Measure the trigger and the rendered menu, then pin the portal content to
  // the viewport. Runs before paint, so the pre-measure hidden frame never
  // shows. Flips above the trigger when the viewport runs out below (openUp).
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const content = contentRef.current;
    if (!anchor || !content) return;
    const r = anchor.getBoundingClientRect();
    const gap = 6;
    const h = content.offsetHeight;
    const openUp = r.bottom + gap + h > window.innerHeight && r.top - gap - h > 0;
    setPos({
      position: "fixed",
      ...(openUp ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
      ...(align === "end"
        ? { right: Math.max(8, window.innerWidth - r.right) }
        : { left: Math.max(8, Math.min(r.left, window.innerWidth - content.offsetWidth - 8)) }),
    });
  }, [open, align]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || contentRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Fixed positioning is measured at open time — close instead of drifting
    // when any ancestor scrolls (capture catches nested scroll containers).
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && contentRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <div ref={anchorRef} className={cn("relative", className)}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open &&
        createPortal(
          <div
            ref={contentRef}
            role="menu"
            style={pos ?? { position: "fixed", visibility: "hidden" }}
            className={cn(
              "z-[80] min-w-[11rem] rounded-xl border border-border bg-surface p-1 shadow-lg",
              // Enter from the trigger's edge: pos carries `bottom` when the menu
              // flipped above it (openUp). The class settles before first paint —
              // pos lands in a pre-paint layout effect.
              pos && "bottom" in pos ? "animate-slide-up-fade" : "animate-slide-down-fade",
              contentClassName,
            )}
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg transition-colors cursor-pointer",
        "hover:bg-surface-2",
        active && "bg-primary-soft text-primary-soft-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
