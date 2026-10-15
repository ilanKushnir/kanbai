"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Bot,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  BookOpen,
  UserRound,
  Link2,
  PlugZap,
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
import { buildConnectBrief } from "@/lib/agent-connect";
import { agentConnection } from "@/lib/agent-status";
import { timeAgo, cn } from "@/lib/utils";
import type { AgentFull } from "@/lib/types";
import Image from "next/image";
import { ActivityList } from "@/components/activity/activity-list";
import type { ActivityItem } from "@/lib/services/activity-feed";

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

type WorkspaceMemberLite = { id: string; name: string; email: string; role: string };

export function AgentsView({
  agents: initial,
  members = [],
  appUrl,
  activity = [],
}: {
  agents: AgentFull[];
  /** Workspace members an agent can be owned by (owner caps its board access). */
  members?: WorkspaceMemberLite[];
  appUrl: string;
  /** What agents did recently — the trust feed. */
  activity?: ActivityItem[];
}) {
  const router = useRouter();
  const [agents, setAgents] = React.useState(initial);
  const [creating, setCreating] = React.useState(false);
  const [revealKey, setRevealKey] = React.useState<{ name: string; key: string } | null>(null);
  const [connecting, setConnecting] = React.useState<ConnectState | null>(null);
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
      <header className="mb-6 flex items-center gap-4">
        <div className="relative hidden h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-surface-2 sm:block">
          <Image src="/art/agent.webp" alt="" fill sizes="64px" className="object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[2rem] font-medium leading-tight">Agents</h1>
          <p className="mt-1 text-sm text-fg-muted">
            An agent gets a key and talks to Kanbai over plain REST — it reads your day, adds tasks, moves them,
            marks them done. Nothing is pushed to it; everything it does shows up below.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="h-4 w-4" /> Add agent
        </Button>
      </header>

      {/* How it works — three steps, no webhooks */}
      <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-3">
        <Step n={1} icon={Plus} title="Create">
          Name it and pick its type.
        </Step>
        <Step n={2} icon={BookOpen} title="Paste the brief">
          One message to your agent. It holds a one-time code, not a key — safe in any chat.
        </Step>
        <Step n={3} icon={PlugZap} title="It connects itself">
          It trades the code for its key, installs the Kanbai skill and checks in. You’ll see it here.
        </Step>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agent connected"
          description="Add Hermes, Claude Code, Codex — or anything that can call a REST API with a key."
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
              members={members}
              appUrl={appUrl}
              now={now}
              onUpdate={update}
              onRevealKey={(key) => setRevealKey({ name: a.name, key })}
              onConnect={(connect) => setConnecting({ agent: a, ...connect })}
              onDeleted={() => setAgents((p) => p.filter((x) => x.id !== a.id))}
            />
          ))}
        </div>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-surface">
        <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
          <h2 className="font-display text-[1.25rem] font-medium">What your agents did</h2>
          <span className="text-xs text-fg-subtle">Last {activity.length} actions</span>
        </div>
        {activity.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-fg-subtle">
            Nothing yet. Once an agent creates, moves or completes something, it is listed here under its name.
          </p>
        ) : (
          <div className="px-2 pb-2">
            <ActivityList items={activity} />
          </div>
        )}
      </section>

      <div className="mt-6 flex items-center justify-center gap-1.5 text-sm text-fg-subtle">
        <BookOpen className="h-4 w-4" />
        Full protocol:{" "}
        <a href="/api/v1/skill.md" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
          the Kanbai skill (SKILL.md)
        </a>
      </div>

      {creating && (
        <CreateAgentModal
          onClose={() => setCreating(false)}
          onCreated={(agent, connect) => {
            setAgents((p) => [...p, agent]);
            setCreating(false);
            setConnecting({ agent, ...connect });
            router.refresh();
          }}
        />
      )}

      {revealKey && (
        <KeyRevealModal name={revealKey.name} value={revealKey.key} appUrl={appUrl} onClose={() => setRevealKey(null)} />
      )}

      {connecting && (
        <ConnectModal
          state={connecting}
          appUrl={appUrl}
          onConnected={(fresh) => update({ ...connecting.agent, ...fresh })}
          onClose={() => setConnecting(null)}
        />
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
  members,
  appUrl,
  now,
  onUpdate,
  onRevealKey,
  onConnect,
  onDeleted,
}: {
  agent: AgentFull;
  members: WorkspaceMemberLite[];
  appUrl: string;
  now: number | null;
  onUpdate: (a: AgentFull) => void;
  onRevealKey: (key: string) => void;
  onConnect: (connect: { code: string; expiresAt: string }) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const meta = AGENT_META[agent.kind as keyof typeof AGENT_META] ?? AGENT_META.custom;

  async function patch(partial: Record<string, unknown>, tag = "save") {
    setBusy(tag);
    try {
      const { agent: next } = await api<{ agent: AgentFull }>(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: partial,
      });
      onUpdate({ ...agent, ...next });
      if (tag === "owner") toast({ title: "Agent owner updated", variant: "success" });
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

  async function connect() {
    setBusy("connect");
    try {
      const { connect } = await api<{ connect: { code: string; expiresAt: string } }>(
        `/api/agents/${agent.id}/connect`,
        { method: "POST" },
      );
      onConnect(connect);
    } catch (e) {
      toast({ title: "Couldn't create a brief", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete agent "${agent.name}"? This revokes its API key.`)) return;
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
  const owner = agent.ownerUserId ? members.find((m) => m.id === agent.ownerUserId) : null;

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
        <Button size="sm" variant={agent.lastSeenAt ? "outline" : "primary"} onClick={connect} disabled={busy === "connect" || disabled}>
          <Link2 className="h-3.5 w-3.5" /> {agent.lastSeenAt ? "Reconnect" : "Connect"}
        </Button>
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
                Show a new API key (manual setup)
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

      {/* Owner */}
      <Field icon={UserRound} label="Owner">
        <Menu
          trigger={
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 cursor-pointer">
              {agent.ownerUserId ? (
                <>
                  <Avatar name={owner?.name ?? "?"} size={16} />
                  {owner?.name ?? "Former member"}
                </>
              ) : (
                "Workspace-wide (no owner)"
              )}
            </button>
          }
          contentClassName="max-h-64 overflow-y-auto"
        >
          {(close) => (
            <>
              <MenuItem
                active={!agent.ownerUserId}
                onClick={() => {
                  close();
                  if (agent.ownerUserId) patch({ ownerUserId: null }, "owner");
                }}
              >
                Workspace-wide (no owner)
              </MenuItem>
              {members.map((m) => (
                <MenuItem
                  key={m.id}
                  active={agent.ownerUserId === m.id}
                  onClick={() => {
                    close();
                    if (agent.ownerUserId !== m.id) patch({ ownerUserId: m.id }, "owner");
                  }}
                >
                  <Avatar name={m.name} size={16} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-[0.625rem] text-fg-subtle">{m.role}</span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        <p className="mt-1.5 text-xs text-fg-subtle">
          A user-owned agent only reaches the boards its owner can access (managers see all, members
          need a board share). Workspace-wide agents reach every board.
        </p>
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
  onCreated: (agent: AgentFull, connect: { code: string; expiresAt: string }) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<string>("hermes");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { agent, connect } = await api<{ agent: AgentFull; connect: { code: string; expiresAt: string } }>(
        "/api/agents",
        { body: { name: name.trim(), kind, color: AGENT_META[kind as keyof typeof AGENT_META]?.color } },
      );
      onCreated(agent, connect);
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

type ConnectState = { agent: AgentFull; code: string; expiresAt: string };

const noopSubscribe = () => () => {};

/** Origin to put in briefs: the configured public URL, else this browser's. */
function useOrigin(appUrl: string) {
  const browserOrigin = React.useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  return appUrl.replace(/\/+$/, "") || browserOrigin;
}

/**
 * The connect brief: one message for the agent. Watches the agent until it
 * redeems the code, then flips to a "connected" state.
 */
function ConnectModal({
  state,
  appUrl,
  onConnected,
  onClose,
}: {
  state: ConnectState;
  appUrl: string;
  onConnected: (fresh: Partial<AgentFull>) => void;
  onClose: () => void;
}) {
  const briefCopy = useCopy();
  const origin = useOrigin(appUrl);
  const { agent, code, expiresAt } = state;
  const brief = buildConnectBrief({ name: agent.name, code, origin, expiresAt });
  const [connected, setConnected] = React.useState(false);
  const baseline = React.useRef(agent.apiKeyLast4);
  const reportConnected = React.useEffectEvent((fresh: AgentFull) => onConnected(fresh));

  // Poll until the key changes — that only happens when the code is redeemed.
  React.useEffect(() => {
    if (connected) return;
    const t = setInterval(async () => {
      try {
        const { agents } = await api<{ agents: AgentFull[] }>("/api/agents");
        const fresh = agents.find((a) => a.id === agent.id);
        if (fresh && fresh.apiKeyLast4 && fresh.apiKeyLast4 !== baseline.current) {
          setConnected(true);
          reportConnected(fresh);
        }
      } catch {
        /* transient */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [agent.id, connected]);

  return (
    <Modal open onClose={onClose} title={`Connect ${agent.name}`} size="lg">
      {connected ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="kb-connected grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-fg">
            <Check className="h-8 w-8" strokeWidth={2.5} />
          </span>
          <div className="animate-slide-up-fade [animation-delay:200ms]">
            <div className="font-display text-xl">{agent.name} is connected</div>
            <p className="mt-1 text-sm text-fg-muted">It has its key and the Kanbai skill. Its actions show up on this page.</p>
          </div>
          <Button variant="primary" className="mt-2 animate-slide-up-fade [animation-delay:320ms]" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Paste this into your chat with {agent.name}. It contains a one-time code, not the key — the agent trades it
            for its own key and sets itself up. Nothing to configure on your side.
          </p>
          <div className="relative">
            <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
{brief}
            </pre>
          </div>
          <Button variant="primary" size="lg" className="w-full" onClick={() => briefCopy.copy(brief)}>
            {briefCopy.copied ? (
              <><Check className="h-4 w-4 animate-icon-pop" /> Copied — now paste it to {agent.name}</>
            ) : (
              <><Copy className="h-4 w-4" /> Copy brief</>
            )}
          </Button>
          <div className="flex items-center justify-center gap-2 pt-1 text-xs text-fg-subtle">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Waiting for {agent.name} to connect… (code valid 24 h)
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Manual setup: a raw key for agents that can't run the connect step. */
function KeyRevealModal({
  name,
  value,
  appUrl,
  onClose,
}: {
  name: string;
  value: string;
  appUrl: string;
  onClose: () => void;
}) {
  const keyCopy = useCopy();
  const origin = useOrigin(appUrl);
  return (
    <Modal open onClose={onClose} title={`API key for ${name}`} size="md">
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-fg">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Shown once. The previous key has stopped working. Prefer “Connect” — it needs no key handling.</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
          <code className="flex-1 break-all font-mono text-sm">{value}</code>
          <Button variant="secondary" size="sm" onClick={() => keyCopy.copy(value)}>
            {keyCopy.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="text-xs text-fg-muted">
          Base URL <code className="rounded bg-surface-2 px-1.5 py-0.5">{origin}/api/v1</code> · skill{" "}
          <a className="underline underline-offset-2" href="/api/v1/skill.md" target="_blank" rel="noreferrer">
            {origin}/api/v1/skill.md
          </a>
        </div>
      </div>
    </Modal>
  );
}
