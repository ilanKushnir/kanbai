"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ShieldCheck, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { SettingsTabs } from "./settings-tabs";
import { api } from "@/lib/client-api";

type Props = {
  isManager: boolean;
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
    createdAt: string;
    isSystemAdmin: boolean;
    role: string;
    workspaceName: string;
  };
};

export function AccountView({ isManager, user }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = React.useState(user.name);
  const [email, setEmail] = React.useState(user.email);
  const [avatarUrl, setAvatarUrl] = React.useState(user.avatarUrl ?? "");
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [curPw, setCurPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [savingPw, setSavingPw] = React.useState(false);

  const profileDirty = name !== user.name || email !== user.email || avatarUrl !== (user.avatarUrl ?? "");

  async function saveProfile() {
    if (!name.trim()) return toast({ title: "Name can't be empty", variant: "error" });
    setSavingProfile(true);
    try {
      await api("/api/account", { method: "PATCH", body: { name: name.trim(), email, avatarUrl } });
      toast({ title: "Profile updated", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (newPw.length < 8) return toast({ title: "New password must be at least 8 characters", variant: "error" });
    if (newPw !== confirmPw) return toast({ title: "Passwords don't match", variant: "error" });
    setSavingPw(true);
    try {
      await api("/api/account/password", { body: { currentPassword: curPw, newPassword: newPw } });
      toast({ title: "Password changed", variant: "success" });
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      toast({ title: "Couldn't change password", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setSavingPw(false);
    }
  }

  async function signOutEverywhere() {
    if (!confirm("Sign out of all devices? You'll need to log in again.")) return;
    try {
      await api("/api/account/sessions", { method: "DELETE" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-fg-muted">Manage your profile and account security.</p>
      <SettingsTabs isManager={isManager} />

      {/* Profile */}
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Profile</h2>
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center gap-3">
            <Avatar name={name || user.name} src={avatarUrl || null} size={56} />
            <div className="text-sm text-fg-muted">
              <div className="font-medium text-fg">{user.workspaceName}</div>
              <div className="capitalize">{user.role} · member since {format(new Date(user.createdAt), "MMM yyyy")}</div>
            </div>
            {user.isSystemAdmin && (
              <Badge tone="iris" className="ml-auto">
                <ShieldCheck className="h-3 w-3" /> System admin
              </Badge>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="acc-name">Display name</Label>
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <Label htmlFor="acc-email">Email</Label>
              <Input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="acc-avatar">Avatar image URL</Label>
            <Input
              id="acc-avatar"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…/photo.jpg"
            />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={saveProfile} disabled={!profileDirty || savingProfile}>
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </div>
      </section>

      {/* Password */}
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Password</h2>
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div>
            <Label htmlFor="cur-pw">Current password</Label>
            <Input id="cur-pw" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-pw">New password</Label>
              <Input id="new-pw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <Label htmlFor="confirm-pw">Confirm new password</Label>
              <Input id="confirm-pw" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={changePassword} disabled={!curPw || !newPw || savingPw}>
              {savingPw ? "Updating…" : "Change password"}
            </Button>
          </div>
        </div>
      </section>

      {/* Security */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Security</h2>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="text-sm">
            <div className="font-medium">Sign out everywhere</div>
            <div className="text-fg-muted">Revoke every active session on all devices.</div>
          </div>
          <Button variant="danger" onClick={signOutEverywhere}>
            <LogOut className="h-4 w-4" /> Sign out all
          </Button>
        </div>
      </section>
    </div>
  );
}
