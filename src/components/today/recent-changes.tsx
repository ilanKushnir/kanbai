"use client";

import * as React from "react";
import type { ActivityItem } from "@/lib/services/activity-feed";
import { ActivityList } from "@/components/activity/activity-list";
import { cn } from "@/lib/utils";

type Filter = "all" | "agent" | "you";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "agent", label: "Agent" },
  { key: "you", label: "You" },
];

/** Every recent change to tasks and tickets — added, done, reopened, moved, edited — by you or your agent. */
export function RecentChanges({ items, currentUserId }: { items: ActivityItem[]; currentUserId: string }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const visible = items
    // A reorder inside the same column isn't a change worth reading.
    .filter((a) => !(a.action === "ticket.moved" && a.meta.sameColumn === true))
    .filter((a) => filter === "all" || (filter === "agent" ? a.actorType === "agent" : a.actorType === "user" && a.actorId === currentUserId));

  return (
    <section className="rounded-2xl border border-border bg-surface px-2 py-2">
      <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
        <span className="font-display text-[1.1rem] font-medium">Recent changes</span>
        <div role="tablist" aria-label="Filter changes" className="flex rounded-lg bg-surface-2 p-0.5 text-[0.6875rem]">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-2 py-0.5 transition-colors",
                filter === f.key ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="px-2 pb-2 text-xs text-fg-subtle">Nothing changed yet. Added, completed and moved tasks show up here.</p>
      ) : (
        <div className="max-h-[22rem] overflow-y-auto overscroll-contain">
          <ActivityList items={visible} compact showBoard />
        </div>
      )}
    </section>
  );
}
