"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, RotateCcw, NotebookPen, KanbanSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { SettingsTabs } from "./settings-tabs";
import { api } from "@/lib/client-api";
import { timeAgo } from "@/lib/utils";

type TrashNote = { id: string; body: string; deletedAt: string };
type TrashTicket = { id: string; title: string; number: number | null; board: string; boardSlug: string; deletedAt: string };

export function TrashView({
  isManager,
  notes: initialNotes,
  tickets: initialTickets,
  retentionDays,
}: {
  isManager: boolean;
  notes: TrashNote[];
  tickets: TrashTicket[];
  retentionDays: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [notes, setNotes] = React.useState(initialNotes);
  const [tickets, setTickets] = React.useState(initialTickets);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => setNotes(initialNotes), [initialNotes]);
  React.useEffect(() => setTickets(initialTickets), [initialTickets]);

  async function act(action: "restore" | "purge", type: "note" | "ticket", id: string) {
    setBusy(id);
    try {
      await api("/api/trash", { method: "POST", body: { action, type, id } });
      if (type === "note") setNotes((n) => n.filter((x) => x.id !== id));
      else setTickets((t) => t.filter((x) => x.id !== id));
      toast({ title: action === "restore" ? "Restored" : "Deleted permanently", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const empty = notes.length === 0 && tickets.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-fg-muted">
        Deleted notes and tickets are kept here for {retentionDays} days, then removed for good. Completed items are never
        auto-deleted.
      </p>
      <SettingsTabs isManager={isManager} />

      {empty ? (
        <EmptyState icon={Trash2} title="Nothing here" description="Deleted notes and tickets will show up here so you can put them back." />
      ) : (
        <div className="space-y-6">
          {tickets.length > 0 && (
            <Group label="Tickets" count={tickets.length}>
              {tickets.map((t) => (
                <Row
                  key={t.id}
                  icon={<KanbanSquare className="h-4 w-4" />}
                  title={t.title}
                  meta={`${t.number != null ? `#${t.number} · ` : ""}${t.board} · deleted ${timeAgo(t.deletedAt)} ago`}
                  busy={busy === t.id}
                  onRestore={() => act("restore", "ticket", t.id)}
                  onPurge={() => act("purge", "ticket", t.id)}
                />
              ))}
            </Group>
          )}
          {notes.length > 0 && (
            <Group label="Notes" count={notes.length}>
              {notes.map((n) => (
                <Row
                  key={n.id}
                  icon={<NotebookPen className="h-4 w-4" />}
                  title={n.body || "(empty note)"}
                  meta={`deleted ${timeAgo(n.deletedAt)} ago`}
                  busy={busy === n.id}
                  onRestore={() => act("restore", "note", n.id)}
                  onPurge={() => act("purge", "note", n.id)}
                />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        {label} <span className="text-fg-subtle/70">{count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  icon,
  title,
  meta,
  busy,
  onRestore,
  onPurge,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-card">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="mt-0.5 truncate text-xs text-fg-subtle">{meta}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={onRestore} disabled={busy} className="shrink-0">
        <RotateCcw className="h-3.5 w-3.5" /> Restore
      </Button>
      <button
        onClick={onPurge}
        disabled={busy}
        title="Delete permanently"
        aria-label="Delete permanently"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
