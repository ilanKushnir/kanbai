import * as React from "react";
import { cn } from "@/lib/utils";

/** Soft chip colors keyed by palette name (used for labels & board colors). */
export const TONES: Record<string, { bg: string; fg: string; dot: string }> = {
  slate: { bg: "rgba(100,116,139,0.14)", fg: "#64748b", dot: "#64748b" },
  iris: { bg: "rgba(109,93,251,0.14)", fg: "#6d5dfb", dot: "#6d5dfb" },
  aqua: { bg: "rgba(21,188,214,0.16)", fg: "#0e97ad", dot: "#15bcd6" },
  emerald: { bg: "rgba(14,169,107,0.15)", fg: "#0ea96b", dot: "#0ea96b" },
  amber: { bg: "rgba(217,138,0,0.16)", fg: "#b87400", dot: "#d98a00" },
  rose: { bg: "rgba(226,61,89,0.14)", fg: "#e23d59", dot: "#e23d59" },
  violet: { bg: "rgba(139,92,246,0.15)", fg: "#8b5cf6", dot: "#8b5cf6" },
  blue: { bg: "rgba(47,143,237,0.14)", fg: "#2f8fed", dot: "#2f8fed" },
};

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
