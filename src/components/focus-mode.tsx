"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { FOCUS_COOKIE } from "@/lib/focus";

/**
 * Focus — Today without the rest of the app: no navigation, no boards, no
 * side panels, just what to do today and tomorrow (the week and everything
 * else one tap away). It is a way of looking at Today, not a second list.
 * The choice is remembered per device in a cookie, so the server renders the
 * right version and opening the app lands straight in it.
 */

type FocusCtx = { focus: boolean; setFocus: (on: boolean) => void };

const Ctx = React.createContext<FocusCtx>({ focus: false, setFocus: () => {} });

export const useFocus = () => React.useContext(Ctx);

export function FocusProvider({ initial, onEnter, children }: { initial: boolean; onEnter?: () => void; children: React.ReactNode }) {
  const [focus, setState] = React.useState(initial);
  const enter = React.useRef(onEnter);
  React.useEffect(() => {
    enter.current = onEnter;
  });

  const setFocus = React.useCallback((on: boolean) => {
    try {
      document.cookie = `${FOCUS_COOKIE}=${on ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    if (on) enter.current?.();
    const apply = () => flushSync(() => setState(on));
    // One soft cross-fade between the two layouts where the browser can.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(apply);
    else apply();
  }, []);

  const value = React.useMemo(() => ({ focus, setFocus }), [focus, setFocus]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The switch: a small track whose knob carries the focus mark. */
export function FocusToggle({ className, showLabel }: { className?: string; showLabel?: boolean }) {
  const { focus, setFocus } = useFocus();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={focus}
      aria-label="Focus mode"
      title={focus ? "Leave focus mode" : "Focus mode — just today and tomorrow"}
      onClick={() => setFocus(!focus)}
      className={cn("group inline-flex shrink-0 items-center gap-2 rounded-full text-[0.75rem] font-medium cursor-pointer", focus ? "text-fg" : "text-fg-subtle hover:text-fg", className)}
    >
      {showLabel && <span>Focus</span>}
      <span
        className={cn(
          "kb-focus-track relative h-6 w-10 rounded-full border transition-colors duration-300",
          focus ? "border-transparent bg-primary" : "border-border bg-surface-2 group-hover:border-border-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 left-0.5 grid h-[1.125rem] w-[1.125rem] -translate-y-1/2 place-items-center rounded-full shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
            focus ? "translate-x-4 bg-primary-fg text-primary" : "bg-surface text-fg-subtle",
          )}
        >
          <FocusMark className="h-3 w-3" on={focus} />
        </span>
      </span>
    </button>
  );
}

/** Concentric rings — the dot fills in when focus is on. */
function FocusMark({ className, on }: { className?: string; on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" opacity={on ? 0.55 : 1} />
      <circle cx="8" cy="8" r={on ? 3 : 2.25} fill="currentColor" style={{ transition: "r 300ms" }} />
    </svg>
  );
}
