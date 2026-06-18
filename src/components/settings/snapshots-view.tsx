"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, History, RotateCcw, Trash2, Bot, Hand, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { SettingsTabs } from "./settings-tabs";
import { api } from "@/lib/client-api";
import { timeAgo } from "@/lib/utils";

type Snap = {
  id: string;
  kind: string;
  reason: string;
  agentName: string | null;
  boardCount: number;
  ticketCount: number;
  createdAt: string;
};

const KIND_META: Record<string, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  auto: { label: "Pre-agent", tone: "iris", icon: Bot },
  manual: { label: "Manual", tone: "slate", icon: Hand },
  pre_restore: { label: "Pre-restore", tone: "amber", icon: Shield },
};

export function SnapshotsView({ snapshots: initial }: { snapshots: Snap[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [snapshots, setSnapshots] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [restoring, setRestoring] = React.useState<Snap | null>(null);

  React.useEffect(() => setSnapshots(initial), [initial]);

  async function takeSnapshot() {
    setBusy(true);
    try {
      await api("/api/snapshots", { method: "POST" });
      toast({ title: "Snapshot captured", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't capture", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function restore(snap: Snap) {
    setBusy(true);
    try {
      await api(`/api/snapshots/${snap.id}/restore`, { method: "POST" });
      toast({ title: "Boards restored", description: "A safety snapshot of the previous state was saved.", variant: "success" });
      setRestoring(null);
      router.refresh();
    } catch (e) {
      toast({ title: "Restore failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function del(snap: Snap) {
    setSnapshots((prev) => prev.filter((s) => s.id !== snap.id));
    try {
      await api(`/api/snapshots/${snap.id}`, { method: "DELETE" });
    } catch {
      router.refresh();
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-fg-muted">Restore your boards to an earlier state.</p>
      <SettingsTabs isManager={true} />

      <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <History className="h-4.5 w-4.5" />
          </span>
          <div className="text-sm text-fg-muted">
            Kanbai automatically captures your boards <strong className="text-fg">before an agent starts working</strong>,
            once per agent session. Manual edits start a fresh session. Restore any point below — the current state is
            saved first, so a restore is always undoable.
          </div>
        </div>
        <Button variant="secondary" onClick={takeSnapshot} disabled={busy} className="shrink-0">
          <Camera className="h-4 w-4" /> Snapshot now
        </Button>
      </div>

      {snapshots.length === 0 ? (
        <EmptyState
          icon={History}
          title="No snapshots yet"
          description="One will be captured automatically the next time an agent makes a change — or take one now."
        />
      ) : (
        <div className="space-y-2">
          {snapshots.map((s) => {
            const meta = KIND_META[s.kind] ?? KIND_META.manual;
            const Icon = meta.icon;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-card"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="truncate text-sm font-medium">
                      {s.reason || (s.agentName ? `Before ${s.agentName}` : "Snapshot")}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-fg-subtle" suppressHydrationWarning>
                    {timeAgo(s.createdAt)} · {s.boardCount} board{s.boardCount === 1 ? "" : "s"} · {s.ticketCount} ticket
                    {s.ticketCount === 1 ? "" : "s"}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setRestoring(s)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </Button>
                <button
                  onClick={() => del(s)}
                  aria-label="Delete snapshot"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-danger cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {restoring && (
        <Modal open onClose={() => setRestoring(null)} title="Restore this snapshot?" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              Your boards will be reset to <strong className="text-fg">{timeAgo(restoring.createdAt)}</strong> (
              {restoring.boardCount} board{restoring.boardCount === 1 ? "" : "s"}, {restoring.ticketCount} ticket
              {restoring.ticketCount === 1 ? "" : "s"}). Boards created after the snapshot are left untouched. The current
              state is saved as a snapshot first, so you can undo this.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRestoring(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => restore(restoring)} disabled={busy}>
                {busy ? "Restoring…" : "Restore boards"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
