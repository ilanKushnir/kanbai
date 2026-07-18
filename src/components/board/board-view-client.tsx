"use client";

import dynamic from "next/dynamic";
import type { BoardData } from "@/lib/services/boards";

type AgentLite = { id: string; name: string; color: string; kind: string };

/**
 * The board is highly interactive (dnd-kit) and owns all its state from props,
 * so we render it client-only. This also avoids SSR'ing dnd-kit's internal
 * accessibility ids, which are unstable across the server/client boundary.
 */
const BoardView = dynamic(() => import("./board-view").then((m) => m.BoardView), {
  ssr: false,
  loading: () => <BoardSkeleton />,
});

export function BoardViewClient(props: {
  board: BoardData;
  agents: AgentLite[];
  members?: { id: string; name: string; avatarUrl?: string | null }[];
  currentUser?: { id: string; name: string } | null;
  initialTicketId?: string;
  returnTo?: "notes";
}) {
  return <BoardView {...props} />;
}

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden px-4 pb-4 md:px-6 lg:px-8">
      {[0, 1, 2, 3].map((c) => (
        <div key={c} className="flex w-[19rem] shrink-0 flex-col">
          <div className="mb-2 h-5 w-28 rounded bg-surface-2" />
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-2/50 p-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 rounded-xl border border-border bg-surface animate-pulse-soft" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
