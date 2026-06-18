"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function AppShell({
  children,
  boards,
  userName,
  userEmail,
  isManager,
  isSystemAdmin,
  workspaces,
  inboxCount,
}: {
  children: React.ReactNode;
  boards: NavBoard[];
  userName: string;
  userEmail: string;
  isManager: boolean;
  isSystemAdmin: boolean;
  workspaces: WorkspaceOption[];
  inboxCount: number;
}) {
  const userMenuProps = { userName, userEmail, isManager, isSystemAdmin, workspaces };
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const [paletteOpen, setPaletteOpen] = React.useState(false);

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
    <div className="flex min-h-screen">
      {/* ── Desktop sidebar ───────────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur-sm">
        <div className="px-4 h-16 flex items-center">
          <Link href="/boards" className="flex items-center">
            <Logo />
          </Link>
        </div>

        <div className="px-3 mb-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg-muted cursor-pointer"
          >
            <Search className="h-4 w-4" />
            <span>Search…</span>
            <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 text-[0.625rem]">⌘K</kbd>
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
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-soft text-primary-soft-fg"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
                {item.key === "notes" && inboxCount > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary-fg">
                    {inboxCount}
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
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/80 backdrop-blur-md px-4">
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

        <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-medium transition-colors",
                  active ? "text-primary" : "text-fg-subtle",
                )}
              >
                <span className="relative">
                  <Icon className="h-5.5 w-5.5" />
                  {item.key === "notes" && inboxCount > 0 && (
                    <span className="absolute -right-2 -top-1 rounded-full bg-primary px-1 text-[0.5625rem] font-semibold text-primary-fg leading-tight">
                      {inboxCount}
                    </span>
                  )}
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
