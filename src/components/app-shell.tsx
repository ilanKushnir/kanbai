"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NotebookPen, Columns3, Bot, Plus, Search, CalendarDays } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { CommandPalette } from "@/components/command-palette";
import { UserMenu, type WorkspaceOption } from "@/components/user-menu";
import { tone } from "@/components/ui/badge";
import { POWERED_BY } from "@/lib/version";
import { cn } from "@/lib/utils";

export type NavBoard = { id: string; name: string; slug: string; color: string };

const NAV = [
  { href: "/my-day", label: "My Day", icon: CalendarDays, key: "my-day" },
  { href: "/notes", label: "Notes", icon: NotebookPen, key: "notes" },
  { href: "/boards", label: "Boards", icon: Columns3, key: "boards" },
  { href: "/agents", label: "Agents", icon: Bot, key: "agents" },
];
const MOBILE_NAV = [...NAV, { href: "/search", label: "Search", icon: Search, key: "search" }];

export function AppShell({
  children,
  boards,
  userName,
  userEmail,
  userAvatarUrl,
  userAvatarColor,
  isManager,
  isSystemAdmin,
  workspaces,
  notesDueCount,
}: {
  children: React.ReactNode;
  boards: NavBoard[];
  userName: string;
  userEmail: string;
  userAvatarUrl?: string | null;
  userAvatarColor?: string | null;
  isManager: boolean;
  isSystemAdmin: boolean;
  workspaces: WorkspaceOption[];
  /** Notes + reflected tickets due today or overdue (the Notes nav badge). */
  notesDueCount: number;
}) {
  const userMenuProps = { userName, userEmail, userAvatarUrl, userAvatarColor, isManager, isSystemAdmin, workspaces };
  const pathname = usePathname();
  const router = useRouter();
  const [optimisticPath, setOptimisticPath] = React.useState<string | null>(null);
  const activePath = optimisticPath && optimisticPath !== pathname ? optimisticPath : pathname;
  const isActive = (href: string) => activePath === href || activePath.startsWith(href + "/");
  const [paletteOpen, setPaletteOpen] = React.useState(false);


  React.useEffect(() => {
    for (const item of MOBILE_NAV) router.prefetch(item.href);
  }, [router]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // "/" opens search when not typing in a field
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
    <div className="flex h-dvh min-h-dvh overflow-hidden bg-bg">
      {/* ── Desktop sidebar ───────────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-4 h-16 flex items-center">
          <Link href="/boards" className="flex items-center">
            <Logo />
          </Link>
        </div>

        <div className="px-3 mb-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2/70 px-3 py-2 text-sm text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg-muted cursor-pointer"
          >
            <Search className="h-4 w-4" />
            <span>Search…</span>
            <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 text-[0.625rem] text-fg-muted">⌘K</kbd>
          </button>
        </div>

        <nav className="px-3 mt-1 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-soft text-primary-soft-fg"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
                <Icon className="h-4.5 w-4.5" />
                {item.label}
                {item.key === "notes" && notesDueCount > 0 && (
                  <span
                    className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary-fg"
                    title="Due today or overdue"
                  >
                    {notesDueCount}
                    <span className="sr-only"> due today or overdue</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 mt-6">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">
              Boards
            </span>
            <Link
              href="/boards?new=1"
              className="grid h-5 w-5 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg transition-colors"
              aria-label="New board"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="space-y-0.5">
            {boards.map((b) => (
              <Link
                key={b.id}
                href={`/boards/${b.slug}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  pathname === `/boards/${b.slug}`
                    ? "bg-surface-2 text-fg font-medium"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone(b.color).dot }} />
                <span className="truncate">{b.name}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-border p-2.5">
          <UserMenu placement="up" {...userMenuProps} />
          <div className="mt-1.5 text-center text-[0.625rem] text-fg-subtle">powered by {POWERED_BY}</div>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────── */}
      <div className="flex-1 flex min-h-0 flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-border bg-surface/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <Logo markClassName="h-7 w-7" />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
              className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
            >
              <Search className="h-4.5 w-4.5" />
            </button>
            <UserMenu compact placement="down" {...userMenuProps} />
          </div>
        </header>

        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain touch-pan-y pb-[calc(5rem+env(safe-area-inset-bottom))] scroll-pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 md:scroll-pb-0">{children}</main>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 py-2 text-[0.625rem] font-medium transition-colors",
                  active ? "text-primary" : "text-fg-subtle",
                )}
                onClick={() => setOptimisticPath(item.href)}
              >
                <span className={cn("relative grid place-items-center rounded-full px-4 py-1 transition-colors", active && "bg-primary-soft")}>
                  <span className="relative">
                    <Icon className="h-5 w-5" />
                    {item.key === "notes" && notesDueCount > 0 && (
                      <span className="absolute -right-2 -top-1 rounded-full bg-primary px-1 text-[0.5625rem] font-semibold text-primary-fg leading-tight">
                        {notesDueCount}
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} boards={boards} />
    </div>
  );
}
