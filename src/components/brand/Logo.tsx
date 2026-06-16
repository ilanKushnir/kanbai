import { cn } from "@/lib/utils";

/** The Kanbai glyph: three ascending kanban columns + an AI agent node. */
export function KanbaiMark({
  className,
  variant = "gradient",
}: {
  className?: string;
  variant?: "gradient" | "mono";
}) {
  const uid = variant === "gradient" ? "g" : "m";
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("h-8 w-8", className)}
      role="img"
      aria-label="Kanbai"
      fill="none"
    >
      {variant === "gradient" && (
        <defs>
          <linearGradient id={`kb-bg-${uid}`} x1="64" y1="48" x2="448" y2="470" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7C6BF5" />
            <stop offset="0.5" stopColor="#5B45F0" />
            <stop offset="1" stopColor="#15BCD6" />
          </linearGradient>
        </defs>
      )}
      <rect
        x="16" y="16" width="480" height="480" rx="124"
        fill={variant === "gradient" ? `url(#kb-bg-${uid})` : "currentColor"}
      />
      <g fill={variant === "gradient" ? "#fff" : "var(--color-surface)"}>
        <rect x="132" y="300" width="58" height="80" rx="20" fillOpacity={0.82} />
        <rect x="227" y="244" width="58" height="136" rx="20" fillOpacity={0.92} />
        <rect x="322" y="188" width="58" height="192" rx="20" />
        <circle cx="351" cy="132" r="30" />
      </g>
      <circle cx="351" cy="132" r="12" fill={variant === "gradient" ? "#15BCD6" : "currentColor"} />
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
        <span className="text-[1.35rem] font-bold tracking-tight leading-none">
          Kanb<span className="text-gradient">ai</span>
        </span>
      )}
    </span>
  );
}
