"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { api } from "@/lib/client-api";
import { BOARD_COLORS } from "@/lib/constants";
import { tone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function NewBoardButton({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(defaultOpen);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState<string>("iris");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { board } = await api<{ board: { slug: string } }>("/api/boards", {
        body: { name: name.trim(), description: description.trim() || undefined, color },
      });
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/boards/${board.slug}`);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create board");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New board
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Create a board" size="sm">
        <div className="space-y-4">
          <div>
            <Label htmlFor="board-name">Name</Label>
            <Input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing Q3"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <div>
            <Label htmlFor="board-desc">Description</Label>
            <Textarea
              id="board-desc"
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
                    color === c ? "ring-2 ring-offset-2 ring-offset-surface scale-110" : "hover:scale-105",
                  )}
                  style={{ backgroundColor: tone(c).dot, boxShadow: color === c ? `0 0 0 2px ${tone(c).dot}` : undefined }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={create} disabled={!name.trim() || busy}>
              {busy ? "Creating…" : "Create board"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
