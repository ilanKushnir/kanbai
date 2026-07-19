"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Columns3, Globe, LayoutGrid, Pin, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import {
  BOARD_SECTION_LABELS,
  buildBoardSections,
  sharedSummary,
  type BoardCardData,
  type BoardSectionKey,
} from "@/lib/board-directory";

const SECTION_ICONS: Record<BoardSectionKey, React.ComponentType<{ className?: string }>> = {
  pinned: Pin,
  workspace: LayoutGrid,
  shared: Users,
};

/** The boards page body: pinned boards first, then the role-appropriate section. */
export function BoardsDirectory({
  boards,
  pinnedBoardIds: initialPinned,
  isManager,
}: {
  boards: BoardCardData[];
  pinnedBoardIds: string[];
  isManager: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pinnedIds, setPinnedIds] = React.useState(initialPinned);
  const [inFlight, setInFlight] = React.useState(0);
  // Re-sync with the server whenever a refresh delivers a new pin list — but
  // not while a toggle is still in flight, or its optimistic state would be
  // clobbered by a payload that predates it.
  const [prevInitial, setPrevInitial] = React.useState(initialPinned);
  if (prevInitial !== initialPinned) {
    setPrevInitial(initialPinned);
    if (inFlight === 0) setPinnedIds(initialPinned);
  }

  async function togglePin(board: BoardCardData) {
    const wasPinned = pinnedIds.includes(board.id);
    // Optimistic — resection immediately, revert on failure.
    setPinnedIds((prev) => (wasPinned ? prev.filter((id) => id !== board.id) : [...prev, board.id]));
    setInFlight((n) => n + 1);
    try {
      const res = await api<{ pinnedBoardIds: string[] }>(`/api/boards/${board.id}/pin`, {
        method: "PUT",
        body: { pinned: !wasPinned },
      });
      // Reconcile only this board — a wholesale replace could drop another
      // board's in-flight optimistic pin. The refresh keeps the router cache
      // (and thus back/forward restores) consistent with the server.
      const serverPinned = res.pinnedBoardIds.includes(board.id);
      setPinnedIds((prev) =>
        serverPinned
          ? prev.includes(board.id)
            ? prev
            : [...prev, board.id]
          : prev.filter((id) => id !== board.id),
      );
      router.refresh();
    } catch (e) {
      setPinnedIds((prev) => (wasPinned ? [...prev, board.id] : prev.filter((id) => id !== board.id)));
      toast({
        title: wasPinned ? "Couldn't unpin board" : "Couldn't pin board",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  const sections = buildBoardSections(boards, pinnedIds, isManager);
  const showHeadings = sections.length > 1 || sections[0]?.key !== "workspace";

  return (
    <div className="space-y-7">
      {sections.map((section) => {
        const Icon = SECTION_ICONS[section.key];
        return (
          <section key={section.key}>
            {/* Always a real h2 (h1 → h2 → card h3 hierarchy); visually hidden
                when there's just the one default section. */}
            {showHeadings ? (
              <h2 className="mb-3 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                <Icon aria-hidden className="h-3.5 w-3.5" />
                {BOARD_SECTION_LABELS[section.key]}
                <span aria-hidden className="font-medium text-fg-subtle/80">
                  ({section.boards.length})
                </span>
              </h2>
            ) : (
              <h2 className="sr-only">{BOARD_SECTION_LABELS[section.key]}</h2>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.boards.map((b) => (
                <BoardCard
                  key={b.id}
                  board={b}
                  pinned={pinnedIds.includes(b.id)}
                  onTogglePin={() => togglePin(b)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  board: b,
  pinned,
  onTogglePin,
}: {
  board: BoardCardData;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const t = tone(b.color);
  const pct = b.ticketCount ? Math.round((b.doneCount / b.ticketCount) * 100) : 0;
  const shared = sharedSummary(b);

  return (
    <div className="group relative">
      <Link
        href={`/boards/${b.slug}`}
        className="relative block overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card transition-all hover:border-border-strong hover:shadow-md hover:-translate-y-px active:translate-y-0"
      >
        <span className="absolute inset-x-0 top-0 h-1" style={{ background: t.dot }} />
        <div className="flex items-center gap-2.5 pr-10">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: t.bg }}>
            <Columns3 className="h-4.5 w-4.5" style={{ color: t.dot }} />
          </span>
          <h3 dir="auto" title={b.name} className="min-w-0 truncate text-base font-semibold tracking-tight">
            {b.name}
          </h3>
        </div>
        {b.description && (
          <p dir="auto" className="mt-2 line-clamp-2 text-sm text-fg-muted">
            {b.description}
          </p>
        )}

        {(shared || b.isPublic || b.viewerLevel === "view") && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {shared && (
              <span className="flex items-center gap-1.5" title={shared.label} aria-label={shared.label}>
                <span aria-hidden className="flex items-center -space-x-1.5">
                  {shared.avatars.map((u) => (
                    <Avatar key={u.id} name={u.name} src={u.avatarUrl} size={20} className="ring-2 ring-surface" />
                  ))}
                </span>
                {shared.overflow > 0 && (
                  <span aria-hidden className="text-[0.6875rem] font-medium text-fg-subtle">
                    +{shared.overflow}
                  </span>
                )}
              </span>
            )}
            {b.isPublic && (
              <Badge tone="aqua">
                <Globe aria-hidden className="h-3 w-3" /> Public link
              </Badge>
            )}
            {b.viewerLevel === "view" && <Badge tone="amber">View only</Badge>}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-fg-subtle">
          <span>
            {b.ticketCount} {b.ticketCount === 1 ? "ticket" : "tickets"}
          </span>
          <span>{pct}% done</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <span
            className="block h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: t.dot }}
          />
        </div>
      </Link>

      <button
        type="button"
        onClick={onTogglePin}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${b.name}` : `Pin ${b.name}`}
        title={pinned ? "Unpin" : "Pin"}
        className={cn(
          "absolute right-1.5 top-2 z-10 grid h-10 w-10 place-items-center rounded-lg transition-colors cursor-pointer md:h-9 md:w-9",
          pinned
            ? "text-primary hover:bg-primary-soft"
            : "text-fg-subtle/60 hover:bg-surface-2 hover:text-fg-muted",
        )}
      >
        <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
      </button>
    </div>
  );
}
