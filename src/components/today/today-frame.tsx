"use client";

import * as React from "react";
import { useFocus } from "@/components/focus-mode";
import { cn } from "@/lib/utils";

/** Today's page around the list: hero and side panels — or, in focus, only the list. */
export function TodayFrame({ hero, aside, children }: { hero: React.ReactNode; aside: React.ReactNode; children: React.ReactNode }) {
  const { focus } = useFocus();
  // The list keeps its place in the tree, so switching never remounts it.
  return (
    <div className={cn("w-full", focus ? "kb-focus-page min-h-full px-4 md:px-8" : "mx-auto max-w-6xl px-4 pt-4 pb-10 md:px-8 md:pt-8")}>
      {!focus && hero}
      <div className={cn("min-w-0", !focus && "mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]")}>
        {children}
        {!focus && aside}
      </div>
    </div>
  );
}
