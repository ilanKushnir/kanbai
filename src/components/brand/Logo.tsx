import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The Kanbai mark: a folded white paper K on a black tile. The source is a
 * single raster (public/brand/mark.png) and the tile inverts in dark mode —
 * the artwork is pure greyscale, so the flip stays faithful.
 */
export function KanbaiMark({
  className,
  variant = "auto",
}: {
  className?: string;
  /** "auto" flips to a paper tile in dark mode; "black" always stays the black tile. */
  variant?: "auto" | "black" | "mono" | "gradient";
}) {
  return (
    <Image
      src="/brand/mark.png"
      alt="Kanbai"
      width={64}
      height={64}
      priority
      className={cn("h-8 w-8 shrink-0 rounded-[26%] select-none", variant === "auto" && "dark:invert", className)}
    />
  );
}

/** Full lockup: mark + "Kanbai" wordmark. */
export function Logo({
  className,
  markClassName,
  showWordmark = true,
  variant = "auto",
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  variant?: "auto" | "black" | "mono" | "gradient";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <KanbaiMark variant={variant} className={cn("h-8 w-8", markClassName)} />
      {showWordmark && (
        <span className="font-display text-[1.4rem] leading-none tracking-[-0.04em]">
          Kanbai
        </span>
      )}
    </span>
  );
}
