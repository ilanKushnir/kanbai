"use client";

import * as React from "react";
import { ArrowUpRight, Building2 } from "lucide-react";
import { tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export type OtherWorkspaceGroup = {
  workspaceId: string;
  workspaceName: string;
  boards: { id: string; name: string; slug: string; color: string }[];
};

/**
 * Boards the viewer can open in their other workspaces. A board shared with
 * you lives in its owner's workspace; this keeps it one tap away from yours —
 * opening one switches workspace and goes straight to the board.
 */
export function OtherWorkspaceBoards({ groups, className }: { groups: OtherWorkspaceGroup[]; className?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (groups.length === 0) return null;

  async function open(workspaceId: string, board: { id: string; slug: string }) {
    if (busy) return;
    setBusy(board.id);
    try {
      await api("/api/workspaces/switch", { body: { workspaceId } });
      window.location.assign(`/boards/${board.slug}`);
    } catch (e) {
      setBusy(null);
      toast({ title: "Couldn't open that board", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <div className={cn("space-y-7", className)}>
      {groups.map((g) => (
        <section key={g.workspaceId}>
          <h2 className="mb-3 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            <Building2 aria-hidden className="h-3.5 w-3.5" />
            <span dir="auto" className="min-w-0 truncate normal-case tracking-normal text-[0.8125rem]">
              {g.workspaceName}
            </span>
            <span aria-hidden className="font-medium text-fg-subtle/80">({g.boards.length})</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.boards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => open(g.workspaceId, b)}
                disabled={busy !== null}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left shadow-card transition-[border-color,scale] duration-150 hover:border-border-strong active:scale-[0.96] disabled:opacity-60 cursor-pointer"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium">
                  {b.name}
                </span>
                <ArrowUpRight
                  className={cn(
                    "h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-fg",
                    busy === b.id && "animate-pulse-soft",
                  )}
                />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
