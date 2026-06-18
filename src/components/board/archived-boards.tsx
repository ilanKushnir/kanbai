"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw, Trash2, ChevronDown } from "lucide-react";
import { tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type ArchivedBoard = { id: string; name: string; slug: string; color: string };

export function ArchivedBoards({ boards: initial }: { boards: ArchivedBoard[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [boards, setBoards] = React.useState(initial);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => setBoards(initial), [initial]);
  if (boards.length === 0) return null;

  async function restore(b: ArchivedBoard) {
    setBusy(b.id);
    try {
      await api(`/api/boards/${b.id}`, { method: "PATCH", body: { archived: false } });
      setBoards((prev) => prev.filter((x) => x.id !== b.id));
      toast({ title: `Restored ${b.name}`, variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't restore", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(b: ArchivedBoard) {
    if (!confirm(`Delete "${b.name}" and all its tickets? This can't be undone.`)) return;
    setBusy(b.id);
    try {
      await api(`/api/boards/${b.id}`, { method: "DELETE" });
      setBoards((prev) => prev.filter((x) => x.id !== b.id));
      toast({ title: `Deleted ${b.name}` });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't delete", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg-muted cursor-pointer"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        <Archive className="h-3.5 w-3.5" /> Archived ({boards.length})
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {boards.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3.5 py-2.5"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
              <button
                onClick={() => restore(b)}
                disabled={busy === b.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
              <button
                onClick={() => remove(b)}
                disabled={busy === b.id}
                aria-label="Delete board"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
