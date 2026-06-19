"use client";

import dynamic from "next/dynamic";
import type { NoteT, AgentLite, BoardLite } from "@/lib/types";

/**
 * Notes is highly interactive (dnd-kit reordering across buckets) and owns its
 * state from props, so we render it client-only — this also sidesteps SSR'ing
 * dnd-kit's internal accessibility ids, which are unstable across the boundary.
 */
const NotesView = dynamic(() => import("./notes-view").then((m) => m.NotesView), {
  ssr: false,
  loading: () => <NotesSkeleton />,
});

export function NotesViewClient(props: {
  notes: NoteT[];
  agents: AgentLite[];
  boards: BoardLite[];
  weekStartsOn: number;
  handedness: "right" | "left";
}) {
  return <NotesView {...props} />;
}

function NotesSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-4 h-7 w-28 rounded bg-surface-2" />
      <div className="h-20 rounded-2xl border border-border bg-surface" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 rounded-xl bg-surface-2/60 animate-pulse-soft" />
        ))}
      </div>
    </div>
  );
}
