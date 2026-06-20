"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Bot,
  KeyRound,
  Webhook,
  Copy,
  Check,
  Download,
  RefreshCw,
  Send,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
  TriangleAlert,
  BookOpen,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { AGENT_KINDS, AGENT_META, ALL_SCOPES } from "@/lib/constants";
import { APP_VERSION } from "@/lib/version";
import { agentConnection } from "@/lib/agent-status";
import { timeAgo, cn } from "@/lib/utils";
import type { AgentFull } from "@/lib/types";

function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(async (text: string) => {
    if (!text || !navigator.clipboard) return; // no clipboard (insecure context) — leave it selectable
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* user can select & copy manually */
    }
  }, []);
  return { copied, copy };
}

function CopyBtn({ value, className }: { value: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(value)}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer",
        className,
      )}
      aria-label="Copy"
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function AgentsView({ agents: initial, appUrl }: { agents: AgentFull[]; appUrl: string }) {
  const router = useRouter();
  const [agents, setAgents] = React.useState(initial);
  const [creating, setCreating] = React.useState(false);
  const [revealKey, setRevealKey] = React.useState<{ name: string; key: string } | null>(null);
  // null until mounted → SSR and first client render agree (no hydration mismatch)
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => setAgents(initial), [initial]);

  // Keep connection state live: tick the clock and re-poll lastSeenAt periodically.
  React.useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(async () => {
      try {
        const { agents: fresh } = await api<{ agents: { id: string; status: string; lastSeenAt: string | null }[] }>(
          "/api/agents",
        );
        setAgents((prev) =>
          prev.map((a) => {
            const f = fresh.find((x) => x.id === a.id);
            return f ? { ...a, status: f.status, lastSeenAt: f.lastSeenAt } : a;
          }),
        );
        setNow(Date.now());
      } catch {
        /* ignore transient poll errors */
      }
    }, 30_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, []);

  function update(a: AgentFull) {
    setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...a } : x)));
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Connect an AI agent to Kanbai. It authenticates with an API key and receives events
            through an optional, signed webhook — keep everything on your LAN.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Add agent
        </Button>
      </header>

      {/* How it works — canonical 4-step flow, shared across apps */}
      <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Step n={1} icon={Plus} title="Create agent">
          Name it and choose its kind.
        </Step>
        <Step n={2} icon={BookOpen} title="Agent brief">
          Copy the one-time key and setup brief.
        </Step>
        <Step n={3} icon={Webhook} title="Webhook">
          Point it at your LAN URL — signing optional.
        </Step>
        <Step n={4} icon={ShieldCheck} title="Manage">
          Rotate keys, toggle access, watch status.
        </Step>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents connected"
          description="Add Hermes, Open Claw, Claude Code, Codex — or any agent that speaks the Kanbai protocol."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Add your first agent
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              appUrl={appUrl}
              now={now}
              onUpdate={update}
              onRevealKey={(key) => setRevealKey({ name: a.name, key })}
              onDeleted={() => setAgents((p) => p.filter((x) => x.id !== a.id))}
            />
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-center gap-1.5 text-sm text-fg-subtle">
        <BookOpen className="h-4 w-4" />
        Full protocol in{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">docs/AGENT_PROTOCOL.md</code>
      </div>

      {creating && (
        <CreateAgentModal
          onClose={() => setCreating(false)}
          onCreated={(agent, key) => {
            setAgents((p) => [...p, agent]);
            setCreating(false);
            setRevealKey({ name: agent.name, key });
            router.refresh();
          }}
        />
      )}

      {revealKey && (
        <KeyRevealModal name={revealKey.name} value={revealKey.key} onClose={() => setRevealKey(null)} />
      )}
    </div>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-fg-muted">{children}</p>
    </div>
  );
}

function AgentCard({
  agent,
  appUrl,
  now,
  onUpdate,
  onRevealKey,
  onDeleted,
}: {
  agent: AgentFull;
  appUrl: string;
  now: number | null;
  onUpdate: (a: AgentFull) => void;
  onRevealKey: (key: string) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = React.useState(agent.webhookUrl ?? "");
  const [secret, setSecret] = React.useState(agent.webhookSecret ?? "");
  const [showSecret, setShowSecret] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const meta = AGENT_META[agent.kind as keyof typeof AGENT_META] ?? AGENT_META.custom;

  async function patch(partial: Record<string, unknown>, tag = "save") {
    setBusy(tag);
    try {
      const { agent: next } = await api<{ agent: AgentFull }>(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: partial,
      });
      onUpdate({ ...agent, ...next, webhookSecret: next.webhookSecret ?? secret });
      if (tag === "save") toast({ title: "Webhook URL saved", variant: "success" });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function rotateKey() {
    if (!confirm("Rotate the API key? The old key stops working immediately.")) return;
    setBusy("rotate");
    try {
      const { apiKey } = await api<{ apiKey: string }>(`/api/agents/${agent.id}/rotate-key`, { method: "POST" });
      onRevealKey(apiKey);
      toast({ title: "New API key generated", description: "The old key no longer works.", variant: "success" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function regenSecret() {
    setBusy("secret");
    try {
      const { secret: s } = await api<{ secret: string }>(`/api/agents/${agent.id}/secret`, { method: "POST" });
      setSecret(s);
      setShowSecret(true);
      onUpdate({ ...agent, webhookSecret: s });
      toast({ title: "New signing secret generated", variant: "success" });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    try {
      await api(`/api/agents/${agent.id}/test`, { method: "POST" });
      toast({ title: "Test webhook sent", description: "Check the delivery log below.", variant: "success" });
      setTimeout(() => router.refresh(), 600);
    } catch (e) {
      toast({ title: "Couldn't send test", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setTimeout(() => setBusy(null), 600);
    }
  }

  async function remove() {
    if (!confirm(`Delete agent "${agent.name}"? This revokes its key and webhook.`)) return;
    await api(`/api/agents/${agent.id}`, { method: "DELETE" });
    onDeleted();
  }

  async function toggleScope(scope: string) {
    const has = agent.scopes.includes(scope);
    const next = has ? agent.scopes.filter((s) => s !== scope) : [...agent.scopes, scope];
    patch({ scopes: next }, "scopes");
  }

  const disabled = agent.status !== "active";
  const conn = now == null ? null : agentConnection(agent, now);

  return (
    <div className={cn("rounded-2xl border border-border bg-surface p-4 shadow-card", disabled && "opacity-70")}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Avatar name={agent.name} color={agent.color} isAgent size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{agent.name}</h3>
            <Badge tone={conn?.tone ?? "slate"} dot>
              <span suppressHydrationWarning>{conn?.label ?? (disabled ? "Disabled" : "…")}</span>
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
            <span>{meta.label}</span>
            <span>·</span>
            <span suppressHydrationWarning>
              {agent.lastSeenAt ? `seen ${timeAgo(agent.lastSeenAt)} ago` : "never connected"}
            </span>
          </div>
        </div>
        <Menu
          align="end"
          trigger={
            <button className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer">
              ⋯
            </button>
          }
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  patch({ status: disabled ? "active" : "disabled" }, "status");
                }}
              >
                {disabled ? "Enable" : "Disable"} agent
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  rotateKey();
                }}
              >
                Rotate API key
              </MenuItem>
              <MenuItem
                className="text-danger hover:bg-danger-soft"
                onClick={() => {
                  close();
                  remove();
                }}
              >
                Delete agent
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {/* API key */}
      <Field icon={KeyRound} label="API key">
        <div className="flex items-center gap-1">
          <code className="flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-xs">
            {agent.apiKeyPrefix ? `${agent.apiKeyPrefix}••••••••${agent.apiKeyLast4}` : "no key"}
          </code>
          <Button size="sm" variant="outline" onClick={rotateKey} disabled={busy === "rotate"}>
            <RefreshCw className={cn("h-3.5 w-3.5", busy === "rotate" && "animate-spin")} /> Rotate
          </Button>
        </div>
      </Field>

      {/* Webhook URL */}
      <Field icon={Webhook} label="Webhook URL (the agent's own endpoint)">
        <div className="flex items-center gap-1">
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="http://<your-lan-ip>:<port>/kanbai/webhook"
            className="font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={webhookUrl === (agent.webhookUrl ?? "") || busy === "save"}
            onClick={() => patch({ webhookUrl })}
          >
            Save
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-fg-subtle">
          Use an internal LAN address the agent can reach. Don&apos;t expose it to the public
          internet.
        </p>
        {agent.webhookUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(() => {
              const last = agent.deliveries[0];
              const verified = last?.status === "success";
              return (
                <>
                  <Badge tone={verified ? "emerald" : "slate"} dot>
                    {verified ? "Verified" : "Not verified"}
                  </Badge>
                  <Badge tone={secret ? "emerald" : "amber"} dot>
                    {secret ? "Signed (HMAC)" : "Unsigned"}
                  </Badge>
                  {last && (
                    <Badge tone="slate">
                      <span suppressHydrationWarning>
                        last ping {timeAgo(last.createdAt)} ·{" "}
                        {last.statusCode ? `HTTP ${last.statusCode}` : last.status}
                      </span>
                    </Badge>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </Field>

      {/* Signing secret */}
      <Field icon={ShieldCheck} label="Signing secret — optional but recommended">
        <div className="flex items-center gap-1">
          <code className="flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-xs">
            {secret ? (showSecret ? secret : "•".repeat(Math.min(secret.length, 28))) : "none"}
          </code>
          {secret && (
            <>
              <button
                onClick={() => setShowSecret((s) => !s)}
                className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer"
                aria-label="Toggle"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <CopyBtn value={secret} />
            </>
          )}
          <Button size="sm" variant="outline" onClick={regenSecret} disabled={busy === "secret"}>
            <RefreshCw className={cn("h-3.5 w-3.5", busy === "secret" && "animate-spin")} />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            placeholder="…or paste your own secret"
            className="font-mono text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) {
                  setSecret(v);
                  patch({ webhookSecret: v }, "secret");
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
          />
          <Button size="sm" variant="primary" onClick={sendTest} disabled={busy === "test" || !agent.webhookUrl}>
            <Send className="h-3.5 w-3.5" /> {busy === "test" ? "Sent" : "Send test"}
          </Button>
        </div>
      </Field>

      {/* Scopes */}
      <Field icon={ShieldCheck} label="Scopes">
        <div className="flex flex-wrap gap-1.5">
          {ALL_SCOPES.map((s) => {
            const on = agent.scopes.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleScope(s)}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] transition-colors cursor-pointer",
                  on
                    ? "border-primary bg-primary-soft text-primary-soft-fg"
                    : "border-border text-fg-subtle hover:bg-surface-2",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Deliveries */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-fg-muted">Recent webhook deliveries</span>
          <button
            onClick={() => router.refresh()}
            className="text-xs text-fg-subtle hover:text-fg cursor-pointer"
          >
            Refresh
          </button>
        </div>
        {agent.deliveries.length === 0 ? (
          <p className="text-xs text-fg-subtle">No deliveries yet. Send a test to check your setup.</p>
        ) : (
          <div className="space-y-1">
            {agent.deliveries.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-xs">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    d.status === "success" ? "bg-success" : d.status === "failed" ? "bg-danger" : "bg-warning",
                  )}
                />
                <span className="font-mono font-medium">{d.event}</span>
                <span className="text-fg-subtle">{d.statusCode ? `HTTP ${d.statusCode}` : d.status}</span>
                {d.error && (
                  <span className="inline-flex items-center gap-1 truncate text-danger" title={d.error}>
                    <TriangleAlert className="h-3 w-3" /> {d.error}
                  </span>
                )}
                <span suppressHydrationWarning className="ml-auto shrink-0 text-fg-subtle">
                  {timeAgo(d.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      {children}
    </div>
  );
}

function CreateAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: AgentFull, key: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<string>("hermes");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { agent, apiKey } = await api<{ agent: AgentFull; apiKey: string }>("/api/agents", {
        body: { name: name.trim(), kind, color: AGENT_META[kind as keyof typeof AGENT_META]?.color },
      });
      toast({ title: `${agent.name} connected`, variant: "success" });
      onCreated({ ...agent, deliveries: [] }, apiKey);
    } catch (e) {
      toast({ title: "Couldn't create agent", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add an agent" size="sm">
      <div className="space-y-4">
        <div>
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hermes"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>
        <div>
          <Label>Type</Label>
          <div className="grid grid-cols-2 gap-2">
            {AGENT_KINDS.map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  if (!name) setName(AGENT_META[k].label === "Custom" ? "" : AGENT_META[k].label);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors cursor-pointer",
                  kind === k ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
                )}
              >
                <span className="h-7 w-7 shrink-0 rounded-lg" style={{ background: AGENT_META[k].color }} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{AGENT_META[k].label}</div>
                  <div className="truncate text-[0.625rem] text-fg-subtle">{AGENT_META[k].blurb}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create agent"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A copy-paste integration brief: API key + base URL + how to drive Kanbai with full control. */
function buildAgentBrief(name: string, key: string, origin: string) {
  const base = `${origin || "https://your-kanbai.app"}/api/v1`;
  return `# Kanbai integration — ${name}

You are connected to Kanbai (a Kanban board system), v${APP_VERSION}, as the agent "${name}".
This key grants FULL control of this workspace: boards, tickets, the capture
inbox, comments, and members. Authenticate every request with the key below.

Setup is four steps: 1) create agent  2) copy this brief  3) the agent registers
its webhook  4) verify with a test ping.

## Credentials (store securely — the key is shown only once)
Base URL:   ${base}
Auth:       Authorization: Bearer ${key}
API key:    ${key}
> Kanbai and its agents run locally/on the same network — prefer the internal/LAN
> base URL (e.g. http://<kanbai-lan-ip>:3000/api/v1) over a public hostname.

## Verify the connection
curl ${base}/me -H "Authorization: Bearer ${key}"
(returns service name + version, apiVersion, your scopes, capabilities, your webhook
status, and a "conventions" block describing the description format, allowed HTML
tags, priorities, and note buckets — read it so you file tickets correctly.)

## What you can do
- Boards:   GET ${base}/boards  ·  GET ${base}/boards/{id}  ·  POST ${base}/boards
- Tickets:  POST ${base}/tickets  ·  PATCH ${base}/tickets/{id}  ·  POST ${base}/tickets/{id}/move
- Comment:  POST ${base}/tickets/{id}/comments
- Inbox:    GET ${base}/inbox  →  POST ${base}/inbox/{noteId}/sort   (turn captured notes into tickets)
- Notes:    GET ${base}/notes  ·  POST ${base}/notes  ·  POST ${base}/notes/{id}/queue
- Members:  GET ${base}/members  ·  POST ${base}/members

## Create a ticket
curl -X POST ${base}/tickets \\
  -H "Authorization: Bearer ${key}" -H "content-type: application/json" \\
  -d '{"boardId":"<id>","title":"Investigate flaky retries","columnName":"To Do","priority":"high","labelNames":["bug"],"description":"<p>Intermittent 500s on retry.</p><ul><li>Check backoff</li><li>Add a test</li></ul>"}'

## Process the capture inbox
Inbox notes carry the user's text plus hints: scheduledDay (the local "YYYY-MM-DD" the note is
slated for, or null), bucket (a coarse today/tomorrow/next_week/next_month/general derived from it),
priority, and suggestedDueDate. When filing a note into a ticket:
- Set the ticket's priority to the note's "priority".
- Set dueDate from any date the NOTE TEXT mentions (e.g. "by Thursday", "before the 5th"); if it
  mentions none, fall back to "suggestedDueDate" (it reflects scheduledDay; it is null when unscheduled,
  so leave the ticket with no due date then).
  POST ${base}/inbox/{noteId}/sort {"boardId":"<id>","title":"...","priority":"...","dueDate":"<ISO or null>"}

## Register your webhook (self-setup)
Point Kanbai at your own callback URL so you get events instead of polling. Prefer
an internal/LAN URL since both run on the same network:
curl -X POST ${base}/agent/webhook \\
  -H "Authorization: Bearer ${key}" -H "content-type: application/json" \\
  -d '{"url":"http://<agent-lan-ip>:<port>/kanbai/webhook"}'
Then fire a test ping to yourself:
curl -X POST ${base}/agent/webhook/test -H "Authorization: Bearer ${key}"

## Webhook events & signing (optional, recommended)
Kanbai POSTs events (ticket.*, note.queued, note.sorted, comment.created, ping) to your URL.
Signing is OPTIONAL but recommended. If a signing secret is set (Agents → Signing secret, or
include "secret" when you register above), Kanbai signs every payload — verify the header
  X-Kanbai-Signature: sha256=<hex HMAC of "{timestamp}.{rawBody}" with the secret>
and reject timestamps older than 5 minutes. With no secret, callbacks are still delivered
UNSIGNED (no signature header) — accept those only on a trusted/internal listener path.

Ticket descriptions are SIMPLE HTML — use <p> <b> <i> <u> <h3> <ul>/<ol>/<li> <blockquote> <a>.
It is sanitized server-side (anything else is stripped); plain text is fine too. Not Markdown.
Priorities: none | low | medium | high | urgent.

## Security
Store the API key securely; do not paste it into public logs or shared chats. Rotate it from
Agents → Rotate API key if it leaks. Full protocol: docs/AGENT_PROTOCOL.md.`;
}

function KeyRevealModal({ name, value, onClose }: { name: string; value: string; onClose: () => void }) {
  const keyCopy = useCopy();
  const briefCopy = useCopy();
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  const brief = buildAgentBrief(name, value, origin);

  function downloadBrief() {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
    const blob = new Blob([brief], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kanbai-brief-${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal open onClose={onClose} title={`Connect ${name}`} size="lg">
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-fg">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Copy this now — the key is shown only once and can’t be retrieved later.</span>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-fg-muted">API key</div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
            <code className="flex-1 break-all font-mono text-sm">{value}</code>
            <Button variant="secondary" size="sm" onClick={() => keyCopy.copy(value)}>
              {keyCopy.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-fg-muted">
              Agent brief — paste this to the agent to integrate (full control)
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={downloadBrief}>
                <Download className="h-4 w-4" /> Download
              </Button>
              <Button variant="ghost" size="sm" onClick={() => briefCopy.copy(brief)}>
                {briefCopy.copied ? (
                  <><Check className="h-4 w-4" /> Copied</>
                ) : (
                  <><Copy className="h-4 w-4" /> Copy brief</>
                )}
              </Button>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
{brief}
          </pre>
        </div>

        <Button variant="primary" className="w-full" onClick={() => briefCopy.copy(brief)}>
          <Copy className="h-4 w-4" /> Copy agent brief
        </Button>
      </div>
    </Modal>
  );
}
