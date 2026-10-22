"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/Logo";
import { CHANGELOG, LATEST_RELEASE_VERSION, type ChangelogRelease } from "@/lib/changelog";
import { cn } from "@/lib/utils";

/**
 * Once per release: what's new in this version, with the full history behind
 * "Older versions". Dismissing (X, Esc, backdrop or "Got it") stores the seen
 * version on the ACCOUNT, so it never shows twice, on any device.
 */
export function WhatsNew({ seenVersion }: { seenVersion: string | null }) {
  const [open, setOpen] = React.useState(seenVersion !== LATEST_RELEASE_VERSION);
  const [showOlder, setShowOlder] = React.useState(false);

  const dismiss = React.useCallback(() => {
    setOpen(false);
    // keepalive: the write survives an immediate navigation or reload.
    void fetch("/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ whatsNewSeen: LATEST_RELEASE_VERSION }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const [current, ...older] = CHANGELOG;

  return (
    <Modal open={open} onClose={dismiss} size="md" title={<span className="font-display">What&apos;s new in <Wordmark /></span>} description={`Version ${current.version} · ${formatDate(current.date)}`}>
      <ReleaseItems release={current} />

      {older.length > 0 && (
        <button
          type="button"
          onClick={() => setShowOlder((v) => !v)}
          aria-expanded={showOlder}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
        >
          {showOlder ? "Hide older versions" : "Older versions"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showOlder && "rotate-180")} />
        </button>
      )}

      {showOlder &&
        older.map((r) => (
          <section key={r.version} className="mt-2">
            <div className="flex items-center gap-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-fg-subtle">
              <span aria-hidden className="h-px flex-1 bg-border" />
              v{r.version} · {formatDate(r.date)}
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
            <ReleaseItems release={r} />
          </section>
        ))}

      {/* Pinned to the scroller's real bottom edge: sticky insets count from the padding box, so -bottom-5 + pb-5 cover the modal's bottom padding. */}
      <div className="sticky -bottom-5 -mx-5 -mb-5 mt-4 border-t border-border bg-surface px-5 pt-3 pb-5">
        <Button variant="primary" className="w-full" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </Modal>
  );
}

function ReleaseItems({ release }: { release: ChangelogRelease }) {
  return (
    <ul className="space-y-1.5">
      {release.items.map((it) => (
        <li key={it.title} className="flex items-start gap-3 rounded-xl bg-surface-2/60 px-3 py-2.5">
          <span aria-hidden className="mt-0.5 text-lg leading-none">{it.emoji}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{it.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{it.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
