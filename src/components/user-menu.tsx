"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LogOut, Settings, CircleUser, ShieldCheck, ChevronsUpDown, Building2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export type WorkspaceOption = { id: string; name: string; role: string; active: boolean };

export function UserMenu({
  userName,
  userEmail,
  userAvatarUrl,
  userAvatarColor,
  isSystemAdmin,
  workspaces,
  placement = "up",
  compact = false,
}: {
  userName: string;
  userEmail: string;
  userAvatarUrl?: string | null;
  userAvatarColor?: string | null;
  isManager?: boolean; // accepted for compatibility (settings gating is server-side)
  isSystemAdmin: boolean;
  workspaces: WorkspaceOption[];
  placement?: "up" | "down";
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const active = workspaces.find((w) => w.active);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function switchTo(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/workspaces/switch", { body: { workspaceId: id } });
      window.location.assign("/my-day");
    } catch {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-2 cursor-pointer",
          compact && "p-0",
        )}
      >
        <Avatar name={userName} src={userAvatarUrl} color={userAvatarColor ?? undefined} size={compact ? 30 : 28} />
        {!compact && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{userName}</div>
              <div className="truncate text-xs text-fg-subtle">{active?.name ?? userEmail}</div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-subtle" />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg animate-slide-down-fade",
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2",
            compact ? "right-0" : "left-0 right-0",
          )}
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-semibold">{userName}</div>
            <div className="truncate text-xs text-fg-subtle">{userEmail}</div>
            {isSystemAdmin && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary-soft px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary-soft-fg">
                <ShieldCheck className="h-3 w-3" /> System admin
              </span>
            )}
          </div>

          {workspaces.length > 1 && (
            <>
              <div className="my-1 h-px bg-border" />
              <div className="px-2.5 pb-1 pt-1 text-[0.625rem] font-semibold uppercase tracking-wider text-fg-subtle">
                Workspaces
              </div>
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  onClick={() => !w.active && switchTo(w.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors cursor-pointer hover:bg-surface-2",
                    w.active && "text-primary",
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.active && <Check className="h-4 w-4 shrink-0" />}
                </button>
              ))}
            </>
          )}

          <div className="my-1 h-px bg-border" />
          <Link
            href="/settings/account"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
          >
            <CircleUser className="h-4 w-4 text-fg-subtle" /> Account
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
          >
            <Settings className="h-4 w-4 text-fg-subtle" /> Settings
          </Link>
          {isSystemAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
            >
              <ShieldCheck className="h-4 w-4 text-fg-subtle" /> Global admin
            </Link>
          )}
          <div className="flex items-center justify-between rounded-lg px-2.5 py-1 text-sm">
            <span className="text-fg-muted">Theme</span>
            <ThemeToggle />
          </div>

          <div className="my-1 h-px bg-border" />
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-danger hover:bg-danger-soft cursor-pointer"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
