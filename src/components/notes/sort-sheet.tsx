"use client";

import * as React from "react";
import { Mic, Square, Trash2, Sparkles, Bot } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { NoteT, AgentLite } from "@/lib/types";

function useRecorder() {
  const [recording, setRecording] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const mediaRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  }

  function stop(): Promise<{ dataUrl: string; mimeType: string; durationMs: number } | null> {
    return new Promise((resolve) => {
      const mr = mediaRef.current;
      if (!mr) return resolve(null);
      const duration = seconds * 1000;
      mr.onstop = () => {
        mr.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () =>
          resolve({ dataUrl: reader.result as string, mimeType: blob.type, durationMs: duration });
        reader.readAsDataURL(blob);
      };
      mr.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
    });
  }

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
  return { recording, seconds, error, start, stop };
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SortSheet({
  note,
  agents,
  onClose,
  onQueued,
}: {
  note: NoteT;
  agents: AgentLite[];
  onClose: () => void;
  onQueued: (note: NoteT) => void;
}) {
  const [agentId, setAgentId] = React.useState<string>(
    agents.find((a) => a.kind === "hermes")?.id ?? agents[0]?.id ?? "",
  );
  const [context, setContext] = React.useState("");
  const [memo, setMemo] = React.useState<{ dataUrl: string; mimeType: string; durationMs: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const rec = useRecorder();
  const { toast } = useToast();

  async function toggleRecord() {
    if (rec.recording) {
      const result = await rec.stop();
      if (result) setMemo(result);
    } else {
      setMemo(null);
      await rec.start();
    }
  }

  async function send() {
    if (!agentId || busy) return;
    setBusy(true);
    try {
      if (memo) {
        await api(`/api/notes/${note.id}/attachments`, {
          body: { kind: "audio", mimeType: memo.mimeType, dataUrl: memo.dataUrl, durationMs: memo.durationMs },
        });
      }
      const { note: updated } = await api<{ note: NoteT }>(`/api/notes/${note.id}/queue`, {
        body: { agentId, sortContext: context.trim() || undefined },
      });
      const agentName = agents.find((a) => a.id === agentId)?.name ?? "the agent";
      toast({ title: `Sent to ${agentName} to sort`, variant: "success" });
      onQueued(updated);
    } catch (e) {
      toast({ title: "Couldn't send note", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Send to an agent to sort"
      description="The agent reads your note (and memo) and files it as a proper ticket."
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 p-3 text-sm text-fg">
          <span className="line-clamp-4 whitespace-pre-wrap">{note.body}</span>
        </div>

        {agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-fg-muted">
            No active agents yet. Add one in <span className="font-medium">Agents</span> first.
          </div>
        ) : (
          <div>
            <Label>Choose an agent</Label>
            <div className="grid grid-cols-2 gap-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAgentId(a.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer",
                    agentId === a.id
                      ? "border-primary bg-primary-soft"
                      : "border-border hover:bg-surface-2",
                  )}
                >
                  <Avatar name={a.name} color={a.color} isAgent size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="truncate text-[0.6875rem] capitalize text-fg-subtle">{a.kind}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="ctx">Instructions for the agent (optional)</Label>
          <Textarea
            id="ctx"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. Put this on the Product board, high priority, due Friday."
            rows={2}
          />
        </div>

        {/* Voice memo */}
        <div>
          <Label>Voice memo (optional)</Label>
          <div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
            <button
              onClick={toggleRecord}
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-colors cursor-pointer",
                rec.recording ? "bg-danger animate-pulse-soft" : "bg-primary hover:bg-primary-hover",
              )}
              aria-label={rec.recording ? "Stop recording" : "Record"}
            >
              {rec.recording ? <Square className="h-4 w-4" /> : <Mic className="h-4.5 w-4.5" />}
            </button>

            <div className="min-w-0 flex-1 text-sm">
              {rec.recording ? (
                <span className="font-medium text-danger">Recording… {fmt(rec.seconds)}</span>
              ) : memo ? (
                <audio controls src={memo.dataUrl} className="h-8 w-full max-w-full" />
              ) : (
                <span className="text-fg-subtle">Tap to record a quick voice note</span>
              )}
            </div>

            {memo && !rec.recording && (
              <button
                onClick={() => setMemo(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer"
                aria-label="Remove memo"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          {rec.error && <p className="mt-1 text-xs text-danger">{rec.error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} disabled={!agentId || busy}>
            {busy ? (
              <>
                <Bot className="h-4 w-4 animate-pulse-soft" /> Sending…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Send to sort
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
