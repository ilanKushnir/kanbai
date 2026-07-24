"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

type UndoPayload =
  | { kind: "ticket"; id: string; title: string; columnId: string; subState: string | null }
  | { kind: "note"; id: string; title: string };

export function MyDayUndoToast({ undo }: { undo: UndoPayload | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const shown = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!undo) return;
    const payload = undo;
    const key = `${payload.kind}:${payload.id}:${"columnId" in payload ? payload.columnId : "note"}`;
    if (shown.current === key) return;
    shown.current = key;

    async function restore() {
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

    toast({
      title: "Done",
      description: payload.title,
      variant: "success",
      actionLabel: "Undo",
      duration: 7000,
      onAction: restore,
    });
    router.replace("/my-day", { scroll: false });
  }, [router, toast, undo]);

  return null;
}
