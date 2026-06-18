"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  Square,
  Trash2,
  Sparkles,
  Bot,
  Columns3,
  Flag,
  CalendarClock,
  Tag,
  CornerDownRight,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge, tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { parseSmartTokens } from "@/lib/smart-parse";
import { priorityMeta, dueMeta } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { NoteT, AgentLite, BoardLite } from "@/lib/types";
import type { SerializedTicket } from "@/lib/serialize";

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

export function ProcessSheet({
  note,
  boards,
  agents,
  onClose,
  onDone,
}: {
  note: NoteT;
  boards: BoardLite[];
  agents: AgentLite[];
  onClose: () => void;
  onDone: (note: NoteT) => void;
}) {
  const [tab, setTab] = React.useState<"ticket" | "agent">(
    boards.length > 0 ? "ticket" : agents.length > 0 ? "agent" : "ticket",
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="File this note"
      description="Turn it into a ticket yourself, or hand it to an agent to sort."
      size="md"
    >
      <div className="mb-4 rounded-xl bg-surface-2 p-3 text-sm text-fg">
        <span className="line-clamp-4 whitespace-pre-wrap">{note.body}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        <TabBtn active={tab === "ticket"} onClick={() => setTab("ticket")}>
          <CornerDownRight className="h-4 w-4" /> Into a ticket
        </TabBtn>
        <TabBtn active={tab === "agent"} onClick={() => setTab("agent")}>
          <Bot className="h-4 w-4" /> Ask an agent
        </TabBtn>
      </div>

      {tab === "ticket" ? (
        <TicketTab note={note} boards={boards} onClose={onClose} onDone={onDone} />
      ) : (
        <AgentTab note={note} agents={agents} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer",
        active ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function TicketTab({
  note,
  boards,
  onClose,
  onDone,
}: {
  note: NoteT;
  boards: BoardLite[];
  onClose: () => void;
  onDone: (note: NoteT) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const parsed = React.useMemo(() => parseSmartTokens(note.body), [note.body]);

  // Smart board suggestion: a board whose name appears in the note text.
  const suggested =
    boards.find((b) => note.body.toLowerCase().includes(b.name.toLowerCase())) ?? boards[0];
  const [boardId, setBoardId] = React.useState(suggested?.id ?? "");
  const board = boards.find((b) => b.id === boardId) ?? boards[0];
  const [columnId, setColumnId] = React.useState(board?.columns[0]?.id ?? "");
  const [title, setTitle] = React.useState(parsed.title);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setColumnId(board?.columns[0]?.id ?? "");
  }, [board?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (boards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-fg-muted">
        Create a board first, then you can file notes into it.
      </div>
    );
  }

  // Effective values: an inline @token wins, else fall back to the note's own
  // priority dot and its bucket-derived due date (so "High" / "Tomorrow" carry through).
  const effPriority = parsed.priority ?? (note.priority && note.priority !== "none" ? note.priority : undefined);
  const effDue = parsed.dueDate ?? note.suggestedDueDate ?? null;
  const due = dueMeta(effDue);
  const pr = effPriority ? priorityMeta(effPriority) : null;
  const hasSmart = !!(pr || due || parsed.labels.length);

  async function create() {
    if (!title.trim() || !boardId || busy) return;
    setBusy(true);
    try {
      const { ticket } = await api<{ ticket: SerializedTicket }>(`/api/notes/${note.id}/promote`, {
        body: {
          boardId,
          columnId,
          title: title.trim(),
          description: parsed.description || undefined,
          priority: effPriority,
          dueDate: effDue,
          labelNames: parsed.labels.length ? parsed.labels : undefined,
        },
      });
      const slug = board?.slug;
      toast({
        title: `Filed on ${board?.name}`,
        variant: "success",
        actionLabel: "View",
        onAction: () => slug && router.push(`/boards/${slug}?ticket=${ticket.id}`),
      });
      onDone({
        ...note,
        status: "sorted",
        ticket: { id: ticket.id, title: ticket.title, boardId: ticket.boardId },
      });
      onClose();
    } catch (e) {
      toast({ title: "Couldn't create ticket", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Ticket title</Label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-9.5 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {hasSmart && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-primary-soft/50 px-2.5 py-2">
          <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-primary-soft-fg">
            <Sparkles className="h-3.5 w-3.5" /> Detected
          </span>
          {pr && (
            <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: pr.color }}>
              <Flag className="h-3 w-3" /> {pr.label}
            </span>
          )}
          {due && (
            <Badge tone={due.tone}>
              <CalendarClock className="h-3 w-3" /> {due.label}
            </Badge>
          )}
          {parsed.labels.map((l) => (
            <Badge key={l} tone="iris" dot>
              {l}
            </Badge>
          ))}
        </div>
      )}

      <div>
        <Label>Board</Label>
        <div className="flex flex-wrap gap-1.5">
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => setBoardId(b.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                boardId === b.id ? "border-primary bg-primary-soft text-primary-soft-fg" : "border-border hover:bg-surface-2",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Column</Label>
        <div className="flex flex-wrap gap-1.5">
          {board?.columns.map((c) => (
            <button
              key={c.id}
              onClick={() => setColumnId(c.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                columnId === c.id ? "border-primary bg-primary-soft text-primary-soft-fg" : "border-border hover:bg-surface-2",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="hidden items-center gap-1 text-[0.6875rem] text-fg-subtle sm:inline-flex">
          <Tag className="h-3 w-3" /> Try <code className="rounded bg-surface-2 px-1">@tomorrow</code>{" "}
          <code className="rounded bg-surface-2 px-1">!high</code>{" "}
          <code className="rounded bg-surface-2 px-1">#label</code>
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!title.trim() || busy}>
            <CornerDownRight className="h-4 w-4" /> {busy ? "Filing…" : "Create ticket"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgentTab({
  note,
  agents,
  onClose,
  onDone,
}: {
  note: NoteT;
  agents: AgentLite[];
  onClose: () => void;
  onDone: (note: NoteT) => void;
}) {
  const { toast } = useToast();
  const [agentId, setAgentId] = React.useState<string>(
    agents.find((a) => a.kind === "hermes")?.id ?? agents[0]?.id ?? "",
  );
  const [context, setContext] = React.useState("");
  const [memo, setMemo] = React.useState<{ dataUrl: string; mimeType: string; durationMs: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const rec = useRecorder();

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
      toast({ title: `Sent to ${agents.find((a) => a.id === agentId)?.name ?? "the agent"} to sort`, variant: "success" });
      onDone(updated);
      onClose();
    } catch (e) {
      toast({ title: "Couldn't send note", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-fg-muted">
        No active agents yet. Add one in <span className="font-medium">Agents</span> first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Choose an agent</Label>
        <div className="grid grid-cols-2 gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setAgentId(a.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer",
                agentId === a.id ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
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
  );
}
