import { cn } from "@/lib/utils";

/** The Kanbai glyph: a captured note card filed down into a kanban lane, with an AI spark. */
export function KanbaiMark({
  className,
  variant = "gradient",
}: {
  className?: string;
  variant?: "gradient" | "mono";
}) {
  const isGradient = variant === "gradient";
  const fg = isGradient ? "#fff" : "var(--color-surface)";
  const lineFill = isGradient ? "#6d5dfb" : "currentColor";
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
          <linearGradient id="kb-bg-g" x1="48" y1="32" x2="464" y2="480" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7C6BF5" />
            <stop offset="1" stopColor="#4A35C4" />
          </linearGradient>
        </defs>
      )}
      <rect x="16" y="16" width="480" height="480" rx="124" fill={isGradient ? "url(#kb-bg-g)" : "currentColor"} />
      {/* lanes */}
      <g fill={fg} fillOpacity={isGradient ? 0.3 : 0.45}>
        <rect x="122" y="300" width="72" height="128" rx="22" />
        <rect x="220" y="300" width="72" height="128" rx="22" />
        <rect x="318" y="300" width="72" height="128" rx="22" />
      </g>
      {/* chevron filing the card into the middle lane */}
      <path d="M214 242 L256 276 L298 242" fill="none" stroke={fg} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      {/* the note card */}
      <rect x="180" y="92" width="152" height="104" rx="24" fill={fg} />
      <rect x="206" y="128" width="92" height="16" rx="8" fill={lineFill} />
      <rect x="206" y="160" width="58" height="16" rx="8" fill={lineFill} fillOpacity={0.55} />
      {/* AI spark */}
      <path
        d="M360 58 c5.6 21 8.4 23.8 28 28 c-19.6 4.2 -22.4 7 -28 28 c-5.6 -21 -8.4 -23.8 -28 -28 c19.6 -4.2 22.4 -7 28 -28 Z"
        fill={fg}
      />
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
