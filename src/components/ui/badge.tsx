import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Soft chip colors keyed by palette name (used for labels & board colors).
 * Each tone resolves through theme-aware CSS variables (globals.css) so chips
 * stay saturated on dark surfaces and deep enough for contrast on light ones.
 */
const TONE_NAMES = ["slate", "iris", "aqua", "emerald", "amber", "rose", "violet", "blue"] as const;
export const TONES: Record<string, { bg: string; fg: string; dot: string }> = Object.fromEntries(
  TONE_NAMES.map((name) => [
    name,
    { bg: `var(--tone-${name}-bg)`, fg: `var(--tone-${name}-fg)`, dot: `var(--tone-${name}-dot)` },
  ]),
);
// Semantic aliases used by callers ("Up next", "Note" chips); "default" keeps
// the quiet slate look, "primary" carries the brand.
TONES.default = TONES.slate;
TONES.primary = TONES.iris;

export function Badge({
  children,
  tone = "slate",
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: string;
  dot?: boolean;
  className?: string;
}) {
  const c = TONES[tone] ?? TONES.slate;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium leading-none",
        className,
      )}
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.dot }} />}
      {children}
    </span>
  );
}

export function tone(name: string) {
  return TONES[name] ?? TONES.slate;
}
