"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

type UndoPayload =
  | { kind: "ticket"; id: string; title: string; columnId: string; subState: string | null }
  | { kind: "note"; id: string; title: string };

const UNDO_WINDOW_MS = 7000;

export function MyDayUndoToast({ undo }: { undo: UndoPayload | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const shown = React.useRef<string | null>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = React.useState<UndoPayload | null>(null);

  const dismiss = React.useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setActive(null);
  }, []);

  React.useEffect(() => {
    if (!undo) return;
    const payload = undo;
    const key = `${payload.kind}:${payload.id}:${"columnId" in payload ? payload.columnId : "note"}`;
    if (shown.current === key) return;
    shown.current = key;

    setActive(payload);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), UNDO_WINDOW_MS);
    router.replace("/my-day", { scroll: false });
  }, [router, undo]);

  React.useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  async function restore(payload: UndoPayload) {
    dismiss();
    try {
      if (payload.kind === "ticket") {
        await api(`/api/tickets/${payload.id}/move`, {
          body: { columnId: payload.columnId, position: 0, subState: payload.subState },
        });
      } else {
        await api(`/api/notes/${payload.id}`, { method: "PATCH", body: { doneOn: null } });
      }
      toast({ title: "Restored to My Day", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't undo", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  if (!active) return null;
  const payload = active;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)] z-[70] flex justify-center px-4 md:bottom-6">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full min-w-0 max-w-md items-center gap-3 rounded-2xl border border-success/30 bg-surface/85 p-3 shadow-2xl shadow-success/15 ring-1 ring-border/60 backdrop-blur-xl animate-toast-in"
      >
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success-soft text-success shadow-[0_0_18px_2px_color-mix(in_oklab,var(--color-success)_30%,transparent)]"
        >
          <Check className="h-4 w-4" strokeWidth={2.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-fg">Done</p>
          <p dir="auto" className="mt-0.5 truncate text-xs text-fg-muted text-start">
            {payload.title}
          </p>
        </div>
        <button
          onClick={() => restore(payload)}
          className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-success px-3.5 text-sm font-semibold text-success-fg shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-[0.97]"
        >
          <Undo2 className="h-4 w-4" />
          Undo
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
