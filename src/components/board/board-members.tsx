"use client";

import * as React from "react";
import { Users, Copy, Check, ShieldCheck, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type BoardMemberRow = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  role: "owner" | "admin" | "member";
  implicit: boolean;
  level: "view" | "edit" | null;
};
type AccessLevel = "none" | "view" | "edit";

function SegAccess({
  value,
  disabled,
  onChange,
}: {
  value: AccessLevel;
  disabled?: boolean;
  onChange: (v: AccessLevel) => void;
}) {
  const opts: AccessLevel[] = ["none", "view", "edit"];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs">
      {opts.map((v) => (
        <button
          key={v}
          disabled={disabled}
          onClick={() => v !== value && onChange(v)}
          className={cn(
            "px-2.5 py-1 capitalize transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
            value === v ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/**
 * Board-level sharing: who can see this board, at what level, and a workspace
 * invite (existing Kanbai accounts only) that grants access to exactly this
 * board. Board sharing never creates accounts.
 */
export function BoardMembers({ boardId, boardName }: { boardId: string; boardName: string }) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<BoardMemberRow[] | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteLevel, setInviteLevel] = React.useState<"view" | "edit">("edit");
  const [inviteBusy, setInviteBusy] = React.useState(false);
  const [inviteToken, setInviteToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await api<{ members: BoardMemberRow[]; canManage: boolean }>(`/api/boards/${boardId}/members`);
      setMembers(res.members);
      setCanManage(res.canManage);
    } catch (e) {
      toast({ title: "Couldn't load members", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }, [boardId, toast]);

  function openModal() {
    setOpen(true);
    void load();
  }

  async function setLevel(userId: string, v: AccessLevel) {
    setBusyId(userId);
    try {
      const { members: next } = await api<{ members: BoardMemberRow[] }>(
        `/api/boards/${boardId}/members/${userId}`,
        { method: "PATCH", body: { level: v === "none" ? null : v } },
      );
      setMembers(next);
    } catch (e) {
      toast({ title: "Couldn't update access", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function createInvite() {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    try {
      const { token } = await api<{ token: string }>("/api/members/invite", {
        body: { email: inviteEmail.trim(), role: "member", boardAccess: [{ boardId, level: inviteLevel }] },
      });
      setInviteToken(token);
    } catch (e) {
      toast({ title: "Couldn't create invite", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteToken) return;
    const link = `${window.location.origin}/invite/${inviteToken}`;
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

  const withAccess = members?.filter((m) => m.implicit || m.level !== null).length ?? 0;

  return (
    <>
      <button
        onClick={openModal}
        title="Board members"
        aria-label="Board members"
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
      >
        <Users className="h-4 w-4" />
        Members
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Board members" description={boardName} size="md">
        {members === null ? (
          <div className="space-y-2 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-surface-2 animate-pulse-soft" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-fg-subtle">
              {withAccess} {withAccess === 1 ? "person has" : "people have"} access. Owners and admins see every
              board; members need a grant here.
            </p>

            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                  <Avatar name={m.name} src={m.avatarUrl} color={m.avatarColor ?? undefined} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      <Badge tone={m.role === "owner" ? "iris" : m.role === "admin" ? "violet" : "slate"}>
                        {m.role}
                      </Badge>
                    </div>
                    <div className="truncate text-xs text-fg-subtle">{m.email}</div>
                  </div>
                  {m.implicit ? (
                    <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
                      <ShieldCheck className="h-3.5 w-3.5" /> all boards
                    </span>
                  ) : canManage ? (
                    <SegAccess
                      value={m.level ?? "none"}
                      disabled={busyId === m.userId}
                      onChange={(v) => setLevel(m.userId, v)}
                    />
                  ) : (
                    <span className="text-xs capitalize text-fg-subtle">{m.level ?? "no access"}</span>
                  )}
                </div>
              ))}
            </div>

            {canManage && (
              <div className="rounded-xl border border-dashed border-border p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
                  <UserPlus className="h-3.5 w-3.5" /> Invite an existing Kanbai user to this board
                </div>
                {inviteToken ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs">
                        {typeof window === "undefined" ? "" : `${window.location.origin}/invite/${inviteToken}`}
                      </code>
                    </div>
                    <Button variant="primary" className="w-full" onClick={copyInvite}>
                      {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy invite link</>}
                    </Button>
                    <p className="text-xs text-fg-subtle">
                      The link works for 14 days and grants {inviteLevel} access to this board only.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Email of an existing Kanbai account"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs">
                        {(["view", "edit"] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setInviteLevel(v)}
                            className={cn(
                              "px-2.5 py-1 capitalize transition-colors cursor-pointer",
                              inviteLevel === v ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2",
                            )}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      <Button variant="secondary" size="sm" onClick={createInvite} disabled={inviteBusy || !inviteEmail.trim()}>
                        {inviteBusy ? "Creating…" : "Create invite link"}
                      </Button>
                    </div>
                    <p className="text-xs text-fg-subtle">
                      They must already have a Kanbai account — this joins them to the workspace with access to this board only.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
