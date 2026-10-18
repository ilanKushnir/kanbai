"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Sun, CalendarDays, Columns3, Sparkles, Plus, Search, Settings } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { SkeletonFor } from "@/components/route-skeletons";
import { CommandPalette } from "@/components/command-palette";
import { UserMenu, type WorkspaceOption } from "@/components/user-menu";
import { SyncIndicator, useSyncSnapshot } from "@/components/sync-indicator";
import * as sync from "@/lib/offline/sync-store";
import { buildToday } from "@/lib/today-model";
import { tone } from "@/components/ui/badge";
import { POWERED_BY } from "@/lib/version";
import { FocusProvider, FocusToggle, useFocus } from "@/components/focus-mode";
import { cn } from "@/lib/utils";

export type NavBoard = { id: string; name: string; slug: string; color: string };

type ShellProps = React.ComponentProps<typeof Shell>;

export function AppShell({ initialFocus, ...props }: ShellProps & { initialFocus: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  // Focus lives on Today: turning it on from anywhere else goes there.
  return (
    <FocusProvider initial={initialFocus} onEnter={() => pathname !== "/today" && router.push("/today")}>
      <Shell {...props} />
    </FocusProvider>
  );
}

function Shell({
  children,
  boards,
  syncScope,
  userName,
  userEmail,
  userAvatarUrl,
  userAvatarColor,
  isManager,
  isSystemAdmin,
  workspaces,
  todayCount,
}: {
  children: React.ReactNode;
  boards: NavBoard[];
  /** Offline-sync partition: one per user and workspace. */
  syncScope: string;
  userName: string;
  userEmail: string;
  userAvatarUrl?: string | null;
  userAvatarColor?: string | null;
  isManager: boolean;
  isSystemAdmin: boolean;
  workspaces: WorkspaceOption[];
  /** Open items due today or overdue (the Today nav badge). */
  todayCount: number;
  /** Nav label for the agent page — the agent's name when there is exactly one. */
}) {
  const userMenuProps = { userName, userEmail, userAvatarUrl, userAvatarColor, isManager, isSystemAdmin, workspaces };
  const pathname = usePathname();
  const router = useRouter();
  // In focus, Today is the whole app: no sidebar, top bar or tab bar.
  const focused = useFocus().focus && pathname === "/today";
  const [optimisticPath, setOptimisticPath] = React.useState<string | null>(null);
  // Any landed navigation (tab or not) settles the optimistic tab.
  const [seenPath, setSeenPath] = React.useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOptimisticPath(null);
  }
  const activePath = optimisticPath && optimisticPath !== pathname ? optimisticPath : pathname;
  const isActive = (href: string) => activePath === href || activePath.startsWith(href + "/");
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Offline sync runs app-wide, so edits queued on Today go up from any page.
  React.useEffect(() => sync.startSync(syncScope), [syncScope]);
  // The Today badge follows the device's copy (queued edits, offline launches).
  const syncData = useSyncSnapshot().data;
  const localTodayCount = React.useMemo(() => {
    if (!syncData) return null;
    const { counts } = buildToday({ tickets: syncData.tickets, notes: syncData.notes });
    return counts.overdue + counts.today;
  }, [syncData]);
  const badgeCount = localTodayCount ?? todayCount;

  const NAV = React.useMemo(
    () => [
      { href: "/today", label: "Today", icon: Sun, key: "today", badge: badgeCount },
      { href: "/plan", label: "Plan", icon: CalendarDays, key: "plan", badge: 0 },
      { href: "/boards", label: "Boards", icon: Columns3, key: "boards", badge: 0 },
      { href: "/agents", label: "Agents", icon: Sparkles, key: "agents", badge: 0, managerOnly: true },
    ],
    [badgeCount],
  );
  const desktopNav = NAV.filter((n) => !n.managerOnly || isManager);
  const mobileNav = [...desktopNav, { href: "/search", label: "Search", icon: Search, key: "search", badge: 0 }];
  const activeTab = mobileNav.findIndex((n) => isActive(n.href));

  // Keep every tab prefetched — on load and whenever the installed app comes
  // back to the foreground (a resumed PWA otherwise starts with a cold cache).
  React.useEffect(() => {
    const warm = () => {
      if (document.visibilityState === "visible") for (const item of mobileNav) router.prefetch(item.href);
    };
    warm();
    document.addEventListener("visibilitychange", warm);
    return () => document.removeEventListener("visibilitychange", warm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // A tapped tab whose page hasn't arrived yet. Its skeleton covers the old
  // page right away (fading in after a beat, so fast switches never flash it).
  const pendingHref = optimisticPath && optimisticPath !== pathname && mobileNav.some((n) => n.href === optimisticPath) ? optimisticPath : null;
  React.useEffect(() => {
    if (!pendingHref) return;
    const t = setTimeout(() => setOptimisticPath(null), 10_000); // give up on a navigation that never lands
    return () => clearTimeout(t);
  }, [pendingHref]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !paletteOpen) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  return (
    <div className="kb-app flex h-dvh overflow-hidden bg-bg">
      {/* ── Desktop sidebar ───────────────────────────── */}
      <aside className={cn("hidden w-60 shrink-0 flex-col border-r border-border bg-surface", !focused && "md:flex")}>
        <div className="px-4 h-16 flex items-center">
          <Link href="/today" className="flex items-center">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <SyncIndicator />
            <FocusToggle />
          </div>
        </div>

        <nav className="px-3 mt-1 space-y-0.5">
          {desktopNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary-soft text-primary-soft-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />}
                <Icon className="h-4.5 w-4.5" />
                {item.label}
                {item.badge > 0 && (
                  <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[0.625rem] font-semibold text-accent-fg" title="Due today or overdue">
                    {item.badge}
                    <span className="sr-only"> due today or overdue</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 mt-6 min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">Boards</span>
            {isManager && (
              <Link
                href="/boards?new=1"
                className="grid h-5 w-5 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg transition-colors"
                aria-label="New board"
              >
                <Plus className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <div className="space-y-0.5">
            {boards.map((b) => (
              <Link
                key={b.id}
                href={`/boards/${b.slug}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  pathname === `/boards/${b.slug}` ? "bg-surface-2 text-fg font-medium" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                <span className="truncate" dir="auto">{b.name}</span>
              </Link>
            ))}
            {boards.length === 0 && <p className="px-3 py-1.5 text-xs text-fg-subtle">No boards yet.</p>}
          </div>
        </div>

        <div className="mt-auto border-t border-border p-2.5">
          <div className="mb-1 flex items-center gap-1">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg-muted cursor-pointer"
            >
              <Search className="h-4 w-4" />
              <span>Search</span>
              <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 text-[0.625rem] text-fg-muted">⌘K</kbd>
            </button>
            <Link href="/settings" aria-label="Settings" className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg">
              <Settings className="h-4 w-4" />
            </Link>
          </div>
          <UserMenu placement="up" {...userMenuProps} />
          <div className="mt-1.5 text-center text-[0.625rem] text-fg-subtle">powered by {POWERED_BY}</div>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────── */}
      <div className="flex-1 flex min-h-0 flex-col min-w-0">
        {/* Mobile top bar */}
        <header className={cn("md:hidden sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-border bg-surface/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md", focused && "hidden")}>
          <Link href="/today"><Logo markClassName="h-7 w-7" /></Link>
          <div className="flex items-center gap-1.5">
            <SyncIndicator />
            <FocusToggle className="mr-1" />
            <UserMenu compact placement="down" {...userMenuProps} />
          </div>
        </header>

        <div className="relative flex-1 min-h-0 min-w-0">
          <main className="h-full overflow-y-auto overscroll-contain touch-pan-y">{children}</main>
          {pendingHref && (
            <div key={pendingHref} className="kb-pending absolute inset-0 overflow-hidden bg-bg" aria-hidden>
              <SkeletonFor href={pendingHref} />
            </div>
          )}
        </div>

      {/* ── Mobile bottom nav ───────────────────────────── */}
      {/* In the layout flow (not position:fixed) so it sits on the real bottom
          edge even where iOS standalone mis-sizes the fixed viewport. */}
      <nav className={cn("kb-tabbar md:hidden shrink-0 z-30 border-t border-border bg-surface", focused && "hidden")}>
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}>
          {/* One pill that glides to the active tab. */}
          {activeTab >= 0 && (
            <span
              aria-hidden
              className="kb-tab-pill pointer-events-none absolute top-1.5 h-8 rounded-full bg-primary-soft"
              style={{
                width: `calc(100% / ${mobileNav.length} - 1.75rem)`,
                left: `calc(100% / ${mobileNav.length} * ${activeTab} + 0.875rem)`,
              }}
            />
          )}
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "kb-tab relative flex flex-col items-center gap-0.5 pt-1.5 pb-1 text-[0.625rem] font-medium transition-colors duration-150",
                  active ? "text-primary" : "text-fg-subtle",
                )}
                // Light the tab on touch, not after the route resolves.
                onPointerDown={() => setOptimisticPath(item.href)}
                onPointerCancel={() => setOptimisticPath(null)}
                onClick={() => setOptimisticPath(item.href)}
              >
                <span className="relative grid h-8 place-items-center px-4">
                  <span className="relative">
                    <Icon className={cn("h-5 w-5 transition-transform duration-200", active && "kb-tab-icon-active")} />
                    {item.badge > 0 && (
                      <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1 text-[0.5625rem] font-semibold text-accent-fg leading-tight">
                        {item.badge}
                        <span className="sr-only"> due today or overdue</span>
                      </span>
                    )}
                  </span>
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} boards={boards} />
    </div>
  );
}
