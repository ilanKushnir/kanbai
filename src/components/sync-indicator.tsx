"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CloudOff, RefreshCw } from "lucide-react";
import * as sync from "@/lib/offline/sync-store";
import { cn } from "@/lib/utils";

const SERVER_SNAPSHOT: sync.SyncSnapshot = {
  status: { online: true, syncing: false, pending: 0, authNeeded: false, baseAt: null, stale: false, syncedAt: 0 },
  data: null,
};
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function useSyncSnapshot() {
  return React.useSyncExternalStore(sync.subscribe, sync.getSnapshot, getServerSnapshot);
}

const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The connection pill. Silent while everything is in sync; otherwise one of:
 *   Offline · saved 9:41 · 2 to sync   (tap to retry)
 *   Syncing 2…  /  Updating…           (only if it takes longer than a beat)
 *   Synced                             (briefly, after offline edits went up)
 *   Sign in to sync 2                  (the session expired)
 */
export function SyncIndicator({ className }: { className?: string }) {
  const { status } = useSyncSnapshot();
  const { online, syncing, pending, authNeeded, baseAt, stale, syncedAt } = status;

  // Busy states wait a beat, so a normal online edit never flashes the pill.
  const busy = online && !authNeeded && (syncing || pending > 0 || stale);
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 700);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [busy]);

  // "Synced" shows only when there was something to see: after offline time
  // or a visible sync.
  const visibleNow = !online || authNeeded || (busy && slow);
  const [armed, setArmed] = React.useState(false);
  const [seenSyncedAt, setSeenSyncedAt] = React.useState(syncedAt);
  const [flashing, setFlashing] = React.useState(false);
  if (visibleNow && !armed) setArmed(true);
  if (syncedAt !== seenSyncedAt) {
    setSeenSyncedAt(syncedAt);
    if (armed || visibleNow) {
      setFlashing(true);
      setArmed(false);
    }
  }
  React.useEffect(() => {
    if (!flashing) return;
    const t = setTimeout(() => setFlashing(false), 1800);
    return () => clearTimeout(t);
  }, [flashing, seenSyncedAt]);

  let content: React.ReactNode = null;
  let tone: "offline" | "busy" | "ok" = "busy";
  if (authNeeded) {
    tone = "offline";
    content = (
      <Link href="/login" className="flex items-center gap-1.5">
        <CloudOff className="h-3.5 w-3.5" />
        Sign in to sync{pending ? ` ${pending}` : ""}
      </Link>
    );
  } else if (!online) {
    tone = "offline";
    content = (
      <button
        type="button"
        onClick={() => sync.retryNow()}
        className="flex items-center gap-1.5 cursor-pointer"
        title={`Offline${baseAt ? ` — showing what was saved at ${timeLabel(baseAt)}` : ""}${pending ? `; ${pending} change${pending === 1 ? "" : "s"} will sync when you're back online` : ""}. Tap to retry.`}
        aria-label={`Offline${baseAt ? `, showing tasks saved at ${timeLabel(baseAt)}` : ""}${pending ? `, ${pending} to sync` : ""}. Tap to retry.`}
      >
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
        <span>Offline</span>
        {baseAt && <span className="hidden text-fg-subtle sm:inline">· saved {timeLabel(baseAt)}</span>}
        {pending > 0 && (
          <span className="text-fg-subtle">
            · {pending}
            <span className="hidden sm:inline"> to sync</span>
          </span>
        )}
      </button>
    );
  } else if (busy && slow) {
    content = (
      <span className="flex items-center gap-1.5">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        {pending > 0 ? `Syncing ${pending}…` : "Updating…"}
      </span>
    );
  } else if (flashing) {
    tone = "ok";
    content = (
      <span className="flex items-center gap-1.5">
        <Check className="h-3.5 w-3.5" />
        Synced
      </span>
    );
  }

  if (!content) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "kb-sync-pill inline-flex h-7 items-center rounded-full border px-2.5 text-[0.75rem] font-medium whitespace-nowrap",
        tone === "offline" && "border-border bg-surface-2 text-fg",
        tone === "busy" && "border-border bg-surface text-fg-muted",
        tone === "ok" && "border-transparent bg-primary-soft text-primary-soft-fg",
        className,
      )}
    >
      {tone === "offline" && <span className="kb-sync-dot mr-1.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
      {content}
    </div>
  );
}
