"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Copy, Check, Trash2, Link2, ShieldCheck, UserPlus, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge, tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  isSelf: boolean;
  access: { boardId: string; level: string }[];
};
type InviteRow = { id: string; token: string; email: string | null; kind: string; role: string; createdAt: string };
type BoardLite = { id: string; name: string; color: string };
type AccessLevel = "none" | "view" | "edit";

function inviteUrl(token: string) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/invite/${token}`;
}

export function MembersManager({
  members,
  boards,
  invites,
  workspaceName,
}: {
  members: MemberRow[];
  boards: BoardLite[];
  invites: InviteRow[];
  workspaceName: string;
}) {
  const [inviting, setInviting] = React.useState(false);
  const [editing, setEditing] = React.useState<MemberRow | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-fg-muted">Manage who can access this workspace.</p>
      <SettingsTabs isManager={true} />
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="mt-1 text-sm text-fg-muted">
            People in <span className="font-medium text-fg">{workspaceName}</span> and their board access.
          </p>
        </div>
        <Button variant="primary" onClick={() => setInviting(true)}>
          <UserPlus className="h-4 w-4" /> Invite
        </Button>
      </header>

      {invites.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Pending invites
          </h2>
          <div className="space-y-2">
            {invites.map((inv) => (
              <InviteItem key={inv.id} invite={inv} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {members.length} {members.length === 1 ? "member" : "members"}
        </h2>
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-card"
            >
              <Avatar name={m.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  {m.isSelf && <span className="text-[0.625rem] text-fg-subtle">you</span>}
                </div>
                <div className="truncate text-xs text-fg-subtle">{m.email}</div>
              </div>
              <Badge tone={m.isOwner ? "iris" : m.role === "admin" ? "violet" : "slate"}>
                {m.role}
              </Badge>
              {!m.isOwner && (
                <div className="flex items-center gap-1">
                  <span className="hidden text-xs text-fg-subtle sm:inline">
                    {m.role === "member" ? `${m.access.length} board${m.access.length === 1 ? "" : "s"}` : "all boards"}
                  </span>
                  <button
                    onClick={() => setEditing(m)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer"
                    aria-label="Edit access"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {inviting && <InviteModal boards={boards} onClose={() => setInviting(false)} />}
      {editing && <AccessModal member={editing} boards={boards} onClose={() => setEditing(null)} />}
    </div>
  );
}

function InviteItem({ invite }: { invite: InviteRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    const link = inviteUrl(invite.token);
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
    await api(`/api/invites/${invite.id}`, { method: "DELETE" }).catch(() => {});
    toast({ title: "Invite revoked" });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-2.5">
      <Link2 className="h-4 w-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{invite.email || "Anyone with the link"}</div>
        <div className="text-xs text-fg-subtle">
          {invite.kind === "account" ? "New account invite" : `Join as ${invite.role}`}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <button
        onClick={revoke}
        className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle hover:bg-danger-soft hover:text-danger cursor-pointer"
        aria-label="Revoke"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SegAccess({ value, onChange }: { value: AccessLevel; onChange: (v: AccessLevel) => void }) {
  const opts: AccessLevel[] = ["none", "view", "edit"];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs">
      {opts.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            "px-2.5 py-1 capitalize transition-colors cursor-pointer",
            value === v ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function BoardAccessList({
  boards,
  access,
  setAccess,
}: {
  boards: BoardLite[];
  access: Record<string, AccessLevel>;
  setAccess: (a: Record<string, AccessLevel>) => void;
}) {
  if (boards.length === 0) {
    return <p className="text-sm text-fg-subtle">No boards yet — create one first.</p>;
  }
  return (
    <div className="space-y-1.5">
      {boards.map((b) => (
        <div key={b.id} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
          <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
          <SegAccess
            value={access[b.id] ?? "none"}
            onChange={(v) => setAccess({ ...access, [b.id]: v })}
          />
        </div>
      ))}
    </div>
  );
}

function toBoardAccessArray(access: Record<string, AccessLevel>) {
  return Object.entries(access)
    .filter(([, level]) => level !== "none")
    .map(([boardId, level]) => ({ boardId, level: level as "view" | "edit" }));
}

function InviteModal({ boards, onClose }: { boards: BoardLite[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<"workspace" | "account">("workspace");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"member" | "admin">("member");
  const [access, setAccess] = React.useState<Record<string, AccessLevel>>({});
  const [busy, setBusy] = React.useState(false);
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const { token } = await api<{ token: string }>("/api/members/invite", {
        body: {
          kind,
          email: email.trim() || undefined,
          role,
          boardAccess: kind === "workspace" && role === "member" ? toBoardAccessArray(access) : undefined,
        },
      });
      setCreatedToken(token);
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't create invite", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  async function copy() {
    if (!createdToken) return;
    const link = inviteUrl(createdToken);
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

  return (
    <Modal open onClose={onClose} title="Invite someone" size="md">
      {createdToken ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>Invite created. Share this link — it works for 14 days.</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{inviteUrl(createdToken)}</code>
          </div>
          <Button variant="primary" className="w-full" onClick={copy}>
            {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy invite link</>}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>Invite type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setKind("workspace")}
                className={cn(
                  "rounded-xl border p-3 text-left text-sm transition-colors cursor-pointer",
                  kind === "workspace" ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
                )}
              >
                <div className="font-medium">Join this workspace</div>
                <div className="mt-0.5 text-xs text-fg-subtle">Collaborate on your boards.</div>
              </button>
              <button
                onClick={() => setKind("account")}
                className={cn(
                  "rounded-xl border p-3 text-left text-sm transition-colors cursor-pointer",
                  kind === "account" ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2",
                )}
              >
                <div className="font-medium">Their own account</div>
                <div className="mt-0.5 text-xs text-fg-subtle">A separate workspace they own.</div>
              </button>
            </div>
          </div>

          <div>
            <Label htmlFor="invite-email">Email (optional)</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Locks the invite to this address"
            />
          </div>

          {kind === "workspace" && (
            <>
              <div>
                <Label>Role</Label>
                <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
                  {(["member", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={cn(
                        "px-3 py-1.5 capitalize transition-colors cursor-pointer",
                        role === r ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-fg-subtle">
                  {role === "admin"
                    ? "Admins manage all boards, members, and agents."
                    : "Members only see the boards you grant below."}
                </p>
              </div>

              {role === "member" && (
                <div>
                  <Label>Board access</Label>
                  <BoardAccessList boards={boards} access={access} setAccess={setAccess} />
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              <Plus className="h-4 w-4" /> {busy ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AccessModal({
  member,
  boards,
  onClose,
}: {
  member: MemberRow;
  boards: BoardLite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [role, setRole] = React.useState<"member" | "admin">(member.role === "admin" ? "admin" : "member");
  const [access, setAccess] = React.useState<Record<string, AccessLevel>>(() => {
    const r: Record<string, AccessLevel> = {};
    member.access.forEach((a) => (r[a.boardId] = a.level as AccessLevel));
    return r;
  });
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/members/${member.userId}`, {
        method: "PATCH",
        body: { role, boardAccess: role === "member" ? toBoardAccessArray(access) : [] },
      });
      toast({ title: "Access updated", variant: "success" });
      onClose();
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : undefined, variant: "error" });
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${member.name} from this workspace?`)) return;
    try {
      await api(`/api/members/${member.userId}`, { method: "DELETE" });
      toast({ title: `${member.name} removed` });
      onClose();
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't remove", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <Modal open onClose={onClose} title={member.name} description={member.email} size="md">
      <div className="space-y-4">
        <div>
          <Label>Role</Label>
          <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
            {(["member", "admin"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "px-3 py-1.5 capitalize transition-colors cursor-pointer",
                  role === r ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {role === "member" ? (
          <div>
            <Label>Board access</Label>
            <BoardAccessList boards={boards} access={access} setAccess={setAccess} />
          </div>
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
            <ShieldCheck className="h-4 w-4" /> Admins have access to every board.
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={remove}>
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
