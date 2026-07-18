"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Building2,
  Columns3,
  Bot,
  NotebookPen,
  Ticket,
  Trash2,
  ShieldCheck,
  MoreHorizontal,
  UserPlus,
  Link2,
  Copy,
  Check,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { timeAgo } from "@/lib/utils";

type Stats = { users: number; workspaces: number; boards: number; tickets: number; notes: number; agents: number };
type UserRow = { id: string; name: string; email: string; systemRole: string; status: string; createdAt: string };
type WorkspaceRow = {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  members: number;
  boards: number;
  createdAt: string;
};
type SystemInviteRow = { id: string; token: string; email: string | null; createdAt: string; expiresAt: string };

export function AdminDashboard({
  currentUserId,
  stats,
  users,
  workspaces,
  systemInvites,
}: {
  currentUserId: string;
  stats: Stats;
  users: UserRow[];
  workspaces: WorkspaceRow[];
  systemInvites: SystemInviteRow[];
}) {
  const cards = [
    { label: "Users", value: stats.users, icon: Users },
    { label: "Workspaces", value: stats.workspaces, icon: Building2 },
    { label: "Boards", value: stats.boards, icon: Columns3 },
    { label: "Tickets", value: stats.tickets, icon: Ticket },
    { label: "Notes", value: stats.notes, icon: NotebookPen },
    { label: "Agents", value: stats.agents, icon: Bot },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Control panel</h1>
        <p className="mt-1 text-sm text-fg-muted">Everything across this Kanbai instance.</p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-xl border border-border bg-surface p-4 shadow-card">
              <Icon className="h-4.5 w-4.5 text-fg-subtle" />
              <div className="mt-2 text-2xl font-bold tracking-tight">{c.value}</div>
              <div className="text-xs text-fg-subtle">{c.label}</div>
            </div>
          );
        })}
      </div>

      <SystemInvites invites={systemInvites} />

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Workspaces</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {workspaces.map((w, i) => (
            <WorkspaceItem key={w.id} ws={w} first={i === 0} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Users</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {users.map((u, i) => (
            <UserItem key={u.id} user={u} isSelf={u.id === currentUserId} first={i === 0} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** System-level account invites — the only way a new person can register. */
function SystemInvites({ invites }: { invites: SystemInviteRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      await api<{ token: string }>("/api/admin/invites", { body: { email: email.trim() || undefined } });
      toast({ title: "System invite created", description: "Copy its link below to share it.", variant: "success" });
      setEmail("");
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't create invite", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold">System account invites</h2>
      <p className="mb-2 text-xs text-fg-subtle">
        Let a new person open a Kanbai account (with their own workspace). Only system admins can issue these —
        workspace invites are managed per-workspace and only work for existing accounts.
      </p>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional — locks the invite to this address)"
            className="flex-1"
          />
          <Button variant="primary" onClick={create} disabled={busy}>
            <UserPlus className="h-4 w-4" /> {busy ? "Creating…" : "Create system invite"}
          </Button>
        </div>
        {invites.length > 0 && (
          <div className="mt-3 space-y-2">
            {invites.map((inv) => (
              <SystemInviteItem key={inv.id} invite={inv} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SystemInviteItem({ invite }: { invite: SystemInviteRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    const link = `${window.location.origin}/invite/${invite.token}`;
    if (!navigator.clipboard) {
      toast({ title: "Copy this link manually", description: link, variant: "info" });
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast({ title: "Couldn't copy — select the link to copy it", variant: "error" });
    }
  }

  async function revoke() {
    await api(`/api/admin/invites/${invite.id}`, { method: "DELETE" }).catch(() => {});
    toast({ title: "System invite revoked" });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2">
      <Link2 className="h-4 w-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{invite.email || "Anyone with the link"}</div>
        <div suppressHydrationWarning className="text-xs text-fg-subtle">
          System account invite · created {timeAgo(invite.createdAt)}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <button
        onClick={revoke}
        className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer"
        aria-label="Revoke invite"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function WorkspaceItem({ ws, first }: { ws: WorkspaceRow; first: boolean }) {
  const router = useRouter();
  const { toast } = useToast();

  async function del() {
    if (!confirm(`Delete workspace "${ws.name}" and ALL its boards, tickets, and agents? This can't be undone.`)) return;
    try {
      await api(`/api/admin/workspaces/${ws.id}`, { method: "DELETE" });
      toast({ title: "Workspace deleted" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't delete", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${first ? "" : "border-t border-border"}`}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-fg-subtle">
        <Building2 className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{ws.name}</div>
        <div className="truncate text-xs text-fg-subtle">owner: {ws.ownerEmail || ws.ownerName}</div>
      </div>
      <div className="hidden gap-4 text-xs text-fg-subtle sm:flex">
        <span>{ws.members} members</span>
        <span>{ws.boards} boards</span>
      </div>
      <button
        onClick={del}
        className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer"
        aria-label="Delete workspace"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function UserItem({ user, isSelf, first }: { user: UserRow; isSelf: boolean; first: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const isAdmin = user.systemRole === "admin";
  const disabled = user.status === "disabled";

  async function patch(body: Record<string, unknown>, label: string) {
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body });
      toast({ title: label, variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${first ? "" : "border-t border-border"}`}>
      <Avatar name={user.name} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{user.name}</span>
          {isSelf && <span className="text-[0.625rem] text-fg-subtle">you</span>}
        </div>
        <div className="truncate text-xs text-fg-subtle">{user.email}</div>
      </div>
      {isAdmin && (
        <Badge tone="iris" dot>
          <ShieldCheck className="h-3 w-3" /> admin
        </Badge>
      )}
      <Badge tone={disabled ? "rose" : "emerald"} dot>
        {disabled ? "disabled" : "active"}
      </Badge>
      <span suppressHydrationWarning className="hidden text-xs text-fg-subtle md:inline">
        {timeAgo(user.createdAt)}
      </span>
      <Menu
        align="end"
        trigger={
          <button className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        }
      >
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                close();
                patch({ systemRole: isAdmin ? "user" : "admin" }, isAdmin ? "Admin revoked" : "Made system admin");
              }}
              className={isSelf && isAdmin ? "pointer-events-none opacity-40" : ""}
            >
              {isAdmin ? "Revoke system admin" : "Make system admin"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                patch({ status: disabled ? "active" : "disabled" }, disabled ? "User enabled" : "User disabled");
              }}
              className={isSelf ? "pointer-events-none opacity-40" : disabled ? "" : "text-danger hover:bg-danger-soft"}
            >
              {disabled ? "Enable account" : "Disable account"}
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  );
}
