"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileCheck2, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type ImportResult = {
  tickets: number;
  notes: number;
  alreadyDone: number;
  skipped: { type: string; id: string; reason: string }[];
};

/**
 * Backup & offline checklist — built for server downtime (moving, migrations):
 * download the checklist before going dark, tick items off from the file
 * itself, then import the progress file here once the server is back.
 */
export function BackupSection() {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  async function importProgress(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast({ title: "That's not a valid progress file", variant: "error" });
      return;
    }
    const items = (parsed as { items?: unknown })?.items;
    if (!Array.isArray(items) || items.length === 0) {
      toast({ title: "No checked items in this file", variant: "error" });
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const res = await api<ImportResult>("/api/import/progress", { body: { items } });
      setResult(res);
      const done = res.tickets + res.notes;
      toast({
        title: done ? `Marked ${done} item${done === 1 ? "" : "s"} done` : "Nothing new to apply",
        description: res.alreadyDone ? `${res.alreadyDone} already done` : undefined,
        variant: "success",
      });
      setPasteText("");
      setPasting(false);
      router.refresh();
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setImporting(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    await importProgress(await file.text());
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        Backup &amp; offline checklist
      </h2>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
        <Row
          icon={<FileCheck2 className="h-4 w-4 text-primary" />}
          title="Offline checklist"
          desc="One HTML file with all your open tickets and notes (incl. Unsorted). Open it anywhere — even with the server down — tick things off, then import your progress below."
        >
          <Button variant="primary" size="sm" onClick={() => (window.location.href = "/api/export/checklist")}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </Row>

        <Row
          icon={<Download className="h-4 w-4 text-fg-muted" />}
          title="Full backup (JSON)"
          desc="Every board, ticket and note in one file — for safekeeping before downtime or migrations."
        >
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/api/export/backup")}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </Row>

        <div className="p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2">
              <Upload className="h-4 w-4 text-fg-muted" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">Import progress</div>
              <div className="text-fg-muted">
                Back online? Load the progress file from your checklist — finished tickets move to Done and notes get
                marked complete. Safe to run twice.
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Choose file…
                </Button>
                <button
                  onClick={() => setPasting((p) => !p)}
                  className="text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline cursor-pointer"
                >
                  {pasting ? "Hide paste box" : "…or paste it"}
                </button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
              </div>
              {pasting && (
                <div className="mt-2">
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={4}
                    placeholder='{"kanbai":"progress", … } — paste the copied progress JSON here'
                    className="w-full rounded-lg border border-border bg-surface-2/50 p-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    className={cn("mt-1.5", !pasteText.trim() && "opacity-60")}
                    disabled={!pasteText.trim() || importing}
                    onClick={() => importProgress(pasteText)}
                  >
                    Import
                  </Button>
                </div>
              )}
              {result && (
                <div className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-fg-muted">
                  <span className="font-medium text-success">
                    {result.tickets} ticket{result.tickets === 1 ? "" : "s"} + {result.notes} note
                    {result.notes === 1 ? "" : "s"} marked done
                  </span>
                  {result.alreadyDone > 0 && <> · {result.alreadyDone} already done</>}
                  {result.skipped.length > 0 && (
                    <> · {result.skipped.length} skipped ({result.skipped[0].reason}
                    {result.skipped.length > 1 ? ", …" : ""})</>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">{title}</div>
        <div className="text-fg-muted">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
