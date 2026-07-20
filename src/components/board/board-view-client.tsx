"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { CalendarDays, Columns3 } from "lucide-react";
import { WeekView } from "./week-view";
import { cn } from "@/lib/utils";
import type { BoardData } from "@/lib/services/boards";

type AgentLite = {
  id: string;
  name: string;
  color: string;
  kind: string;
  ownerUserId: string | null;
  ownerName: string | null;
};

/**
 * The board is highly interactive (dnd-kit) and owns all its state from props,
 * so we render it client-only. This also avoids SSR'ing dnd-kit's internal
 * accessibility ids, which are unstable across the server/client boundary.
 */
const BoardView = dynamic(() => import("./board-view").then((m) => m.BoardView), {
  ssr: false,
  loading: () => <BoardSkeleton />,
});

type ViewMode = "kanban" | "week";

/** Remembered per board so each board reopens in the view it was left in. */
const viewStorageKey = (boardId: string) => `kanbai.board-view.${boardId}`;

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function BoardViewClient(props: {
  board: BoardData;
  agents: AgentLite[];
  members?: { id: string; name: string; avatarUrl?: string | null; avatarColor?: string | null }[];
  currentUser?: { id: string; name: string } | null;
  weekStartsOn?: number;
  initialTicketId?: string;
  returnTo?: "notes";
}) {
  const storageKey = viewStorageKey(props.board.id);
  // localStorage is an external store: the server snapshot (null → kanban)
  // keeps SSR/hydration consistent, and the client snapshot applies the saved
  // preference right after — with cross-tab sync via the storage event.
  const storedMode = React.useSyncExternalStore(
    subscribeToStorage,
    () => {
      try {
        return localStorage.getItem(storageKey);
      } catch {
        return null; /* storage unavailable → default view */
      }
    },
    () => null,
  );
  // In-session choice, scoped to the board it was made on (client-side board
  // switches can keep this component instance alive).
  const [override, setOverride] = React.useState<{ boardId: string; mode: ViewMode } | null>(null);
  // A ticket deep-link (from notes/search) stays on kanban, where the modal
  // opens and the returnTo flow lives.
  const mode: ViewMode =
    (override?.boardId === props.board.id ? override.mode : null) ??
    (storedMode === "week" && !props.initialTicketId ? "week" : "kanban");

  function switchMode(next: ViewMode) {
    setOverride({ boardId: props.board.id, mode: next });
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* storage unavailable → the choice just doesn't persist */
    }
  }

  const switcher = <ViewSwitch mode={mode} onChange={switchMode} />;

  if (mode === "week") {
    return (
      <WeekView
        board={props.board}
        agents={props.agents}
        members={props.members}
        currentUser={props.currentUser}
        weekStartsOn={props.weekStartsOn}
        switcher={switcher}
      />
    );
  }
  return (
    <BoardView
      board={props.board}
      agents={props.agents}
      members={props.members}
      currentUser={props.currentUser}
      initialTicketId={props.initialTicketId}
      returnTo={props.returnTo}
      switcher={switcher}
    />
  );
}

/** Kanban ⇄ Week segmented control, rendered inside each view's toolbar row. */
function ViewSwitch({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const options = [
    { mode: "kanban" as const, label: "Board", Icon: Columns3 },
    { mode: "week" as const, label: "Week", Icon: CalendarDays },
  ];
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {options.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          onClick={() => m !== mode && onChange(m)}
          aria-pressed={mode === m}
          className={cn(
            "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors cursor-pointer",
            mode === m ? "bg-primary-soft text-primary-soft-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label} view</span>
        </button>
      ))}
    </div>
  );
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
