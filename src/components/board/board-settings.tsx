"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Settings2, Copy, Check, Archive, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { BOARD_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function BoardSettings({
  boardId,
  name: initialName,
  description: initialDescription,
  color: initialColor,
}: {
  boardId: string;
  name: string;
  description: string | null;
  color: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(initialDescription ?? "");
  const [color, setColor] = React.useState(initialColor);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const dirty = name !== initialName || description !== (initialDescription ?? "") || color !== initialColor;

  async function save() {
    if (!name.trim()) return toast({ title: "Name can't be empty", variant: "error" });
    setBusy(true);
    try {
      await api(`/api/boards/${boardId}`, {
        method: "PATCH",
        body: { name: name.trim(), description: description.trim() || null, color },
      });
      toast({ title: "Board updated", variant: "success" });
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    try {
      await api(`/api/boards/${boardId}`, { method: "PATCH", body: { archived: true } });
      toast({ title: "Board archived", description: "Find it under Archived on the Boards page." });
      router.push("/boards");
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't archive", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/boards/${boardId}`, { method: "DELETE" });
      toast({ title: "Board deleted" });
      router.push("/boards");
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't delete", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  async function copyId() {
    if (!navigator.clipboard) return toast({ title: "Board ID", description: boardId, variant: "info" });
    try {
      await navigator.clipboard.writeText(boardId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast({ title: "Board ID", description: boardId, variant: "info" });
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Board settings"
        aria-label="Board settings"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
      >
        <Settings2 className="h-4 w-4" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Board settings" size="sm">
        <div className="space-y-4">
          <div>
            <Label htmlFor="bs-name">Name</Label>
            <Input id="bs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div>
            <Label htmlFor="bs-desc">Description</Label>
            <Textarea
              id="bs-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={2}
            />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {BOARD_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={cn(
                    "h-7 w-7 rounded-full transition-transform cursor-pointer",
                    color === c ? "scale-110 ring-2 ring-offset-2 ring-offset-surface" : "hover:scale-105",
                  )}
                  style={{ backgroundColor: tone(c).dot, boxShadow: color === c ? `0 0 0 2px ${tone(c).dot}` : undefined }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" onClick={save} disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>

          <div className="border-t border-border pt-3">
            <button
              onClick={copyId}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-sm text-fg-muted hover:text-fg cursor-pointer"
            >
              <span className="flex items-center gap-2">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                Copy board ID <span className="text-xs text-fg-subtle">(for the agent API)</span>
              </span>
            </button>
          </div>

          {/* Danger zone */}
          <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-danger/80">Danger zone</div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg-muted">Hide this board without deleting it.</span>
              <Button variant="secondary" onClick={archive} disabled={busy}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg-muted">Delete this board and all its tickets.</span>
              {confirmDelete ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={remove} disabled={busy}>
                    {busy ? "Deleting…" : "Delete forever"}
                  </Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
