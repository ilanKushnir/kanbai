import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The day's opening: a time-of-day illustration fading into the page, with a
 * display greeting and one plain sentence about the day. Rendered on the server
 * with the hour passed in, so it never flashes the wrong period.
 */
export function TodayHero({
  period,
  greeting,
  dateLabel,
  summary,
  compact = false,
}: {
  period: "morning" | "afternoon" | "evening" | "night";
  greeting: string;
  dateLabel: string;
  summary: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("kb-hero -mx-4 -mt-4 md:-mx-8 md:-mt-8 md:rounded-b-[2rem]", compact ? "h-44 md:h-52" : "h-56 md:h-72")}>
      <Image
        src={`/art/today-${period}.webp`}
        alt=""
        fill
        priority
        sizes="(min-width: 1280px) 1100px, 100vw"
        className="animate-hero-in object-cover"
      />
      <div className="relative z-10 flex h-full flex-col justify-end px-4 pb-4 md:px-8 md:pb-6">
        <p className="text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-neutral-300">{dateLabel}</p>
        <h1 className="font-display mt-1 text-[2rem] font-medium leading-[1.05] text-white md:text-[2.75rem]">{greeting}</h1>
        <p className="mt-1.5 text-[0.95rem] text-neutral-300">{summary}</p>
      </div>
    </div>
  );
}
