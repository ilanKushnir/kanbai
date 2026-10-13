import { useId } from "react";
import { cn } from "@/lib/utils";

/** The Kanbai mark: a warm tile with a rising sun and a check — "today, done". */
export function KanbaiMark({
  className,
  variant = "gradient",
}: {
  className?: string;
  variant?: "gradient" | "mono";
}) {
  const isGradient = variant === "gradient";
  const fg = isGradient ? "#fff7ee" : "var(--color-surface)";
  // Unique per instance: a shared id resolves to the FIRST match in the DOM,
  // which may sit in a display:none sidebar and then paints nothing.
  const gradId = `kb-bg-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("h-8 w-8", className)}
      role="img"
      aria-label="Kanbai"
      fill="none"
    >
      {isGradient && (
        <defs>
          <linearGradient id={gradId} x1="48" y1="32" x2="464" y2="480" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#e97a4e" />
            <stop offset="1" stopColor="#9a3715" />
          </linearGradient>
        </defs>
      )}
      <rect x="16" y="16" width="480" height="480" rx="124" fill={isGradient ? `url(#${gradId})` : "currentColor"} />
      {/* horizon */}
      <rect x="96" y="318" width="320" height="22" rx="11" fill={fg} fillOpacity={isGradient ? 0.55 : 0.6} />
      {/* sun */}
      <path d="M150 318 A106 106 0 0 1 362 318 Z" fill={fg} />
      {/* rays */}
      <g stroke={fg} strokeWidth="22" strokeLinecap="round" opacity={isGradient ? 0.9 : 1}>
        <path d="M256 112 V150" />
        <path d="M150 156 L176 182" />
        <path d="M362 156 L336 182" />
      </g>
      {/* check */}
      <path d="M212 262 L244 292 L304 232" stroke={isGradient ? "#9a3715" : "currentColor"} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      {/* ground lines (the list) */}
      <g fill={fg} fillOpacity={isGradient ? 0.5 : 0.55}>
        <rect x="128" y="370" width="256" height="18" rx="9" />
        <rect x="168" y="410" width="176" height="18" rx="9" />
      </g>
    </svg>
  );
}

/** Full lockup: mark + "Kanbai" wordmark. */
export function Logo({
  className,
  markClassName,
  showWordmark = true,
  variant = "gradient",
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  variant?: "gradient" | "mono";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <KanbaiMark variant={variant} className={cn("h-8 w-8", markClassName)} />
      {showWordmark && (
        <span className="font-display text-[1.45rem] font-medium leading-none tracking-tight">
          Kanbai
        </span>
      )}
    </span>
  );
}
