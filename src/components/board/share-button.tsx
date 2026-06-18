"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Share2, Globe, Lock, Copy, Check, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export function ShareButton({
  boardId,
  isPublic: initialPublic,
  publicId: initialPublicId,
}: {
  boardId: string;
  isPublic: boolean;
  publicId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [isPublic, setIsPublic] = React.useState(initialPublic);
  const [publicId, setPublicId] = React.useState(initialPublicId);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const url = publicId && typeof window !== "undefined" ? `${window.location.origin}/p/${publicId}` : "";

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const res = await api<{ public?: { isPublic: boolean; publicId: string | null } }>(
        `/api/boards/${boardId}`,
        { method: "PATCH", body: { isPublic: next } },
      );
      setIsPublic(res.public?.isPublic ?? next);
      if (res.public?.publicId) setPublicId(res.public.publicId);
      toast({ title: next ? "Board is now public" : "Board is private again", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't update sharing", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 cursor-pointer"
      >
        {isPublic ? <Globe className="h-3.5 w-3.5 text-success" /> : <Share2 className="h-3.5 w-3.5" />}
        Share
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Share board" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-border p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2">
              {isPublic ? <Globe className="h-4.5 w-4.5 text-success" /> : <Lock className="h-4.5 w-4.5 text-fg-subtle" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{isPublic ? "Public to anyone with the link" : "Private"}</div>
              <div className="text-xs text-fg-muted">
                {isPublic ? "Read-only — no sign-in required." : "Only members with access can view."}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={isPublic}
              disabled={busy}
              onClick={() => toggle(!isPublic)}
              className={cn(
                "relative h-6 w-10 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50",
                isPublic ? "bg-primary" : "bg-surface-3",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  isPublic ? "translate-x-4.5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {isPublic && url && (
            <div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="flex-1" onClick={copy}>
                  {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
                </Button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-lg border border-border px-3 hover:bg-surface-2"
                  aria-label="Open public board"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
