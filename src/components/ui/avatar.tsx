import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";
import { DEFAULT_AVATAR_COLOR } from "@/lib/avatar-colors";
import { Bot } from "lucide-react";

export function Avatar({
  name,
  color,
  isAgent = false,
  size = 24,
  src,
  className,
  title,
}: {
  name: string;
  color?: string;
  isAgent?: boolean;
  size?: number;
  /** Optional image URL (e.g. a user's avatarUrl); falls back to initials if absent. */
  src?: string | null;
  className?: string;
  /** Tooltip override, e.g. an agent assignee with owner context ("Hermes · Yuval"). */
  title?: string;
}) {
  const bg = color ?? DEFAULT_AVATAR_COLOR;
  return (
    <span
      title={title ?? name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white overflow-hidden",
        className,
      )}
      style={{
        width: size,
        height: size,
        // Depth comes from darkening, never alpha-lightening — white initials
        // must stay legible across every stop of the gradient.
        background: isAgent
          ? `linear-gradient(135deg, ${bg}, ${bg}cc)`
          : `linear-gradient(135deg, ${bg}, color-mix(in oklab, ${bg} 78%, #000))`,
        fontSize: size * 0.42,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} width={size} height={size} className="h-full w-full object-cover" />
      ) : isAgent ? (
        <Bot style={{ width: size * 0.58, height: size * 0.58 }} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
