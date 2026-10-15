"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useSyncSnapshot } from "@/components/sync-indicator";
import { buildToday, greetingFor, summaryLine } from "@/lib/today-model";

/**
 * The day's opening: a time-of-day illustration fading into the page, with a
 * display greeting and one plain sentence about the day. The first paint uses
 * the server's words (so hydration matches and the period never flashes);
 * after mount it follows the device — the clock, for a page reopened from the
 * offline cache hours later, and the synced task list, for the summary.
 */
export function TodayHero({
  period: serverPeriod,
  greeting: serverGreeting,
  dateLabel: serverDateLabel,
  summary: serverSummary,
  name,
  compact = false,
}: {
  name?: string | null;
  period: "morning" | "afternoon" | "evening" | "night";
  greeting: string;
  dateLabel: string;
  summary: string;
  compact?: boolean;
}) {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const tick = () => document.visibilityState === "visible" && setNow(new Date());
    tick();
    const t = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const data = useSyncSnapshot().data;
  const local = now ? greetingFor(now, name) : null;
  const period = local?.period ?? serverPeriod;
  const greeting = local?.greeting ?? serverGreeting;
  const dateLabel = now ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : serverDateLabel;
  const summary = React.useMemo(
    () => (now && data ? summaryLine(buildToday({ tickets: data.tickets, notes: data.notes, now }).counts) : serverSummary),
    [now, data, serverSummary],
  );
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
