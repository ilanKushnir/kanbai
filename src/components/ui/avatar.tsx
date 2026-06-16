import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";
import { Bot } from "lucide-react";

export function Avatar({
  name,
  color,
  isAgent = false,
  size = 24,
  className,
}: {
  name: string;
  color?: string;
  isAgent?: boolean;
  size?: number;
  className?: string;
}) {
  const bg = color ?? "#6d5dfb";
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white overflow-hidden",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: isAgent
          ? `linear-gradient(135deg, ${bg}, ${bg}cc)`
          : `linear-gradient(135deg, ${bg}, ${bg}aa)`,
        fontSize: size * 0.42,
      }}
    >
      {isAgent ? <Bot style={{ width: size * 0.58, height: size * 0.58 }} /> : initials(name)}
    </span>
  );
}
