"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/trash", label: "Recently deleted" },
  { href: "/settings/members", label: "Members", managerOnly: true },
  { href: "/settings/snapshots", label: "Snapshots", managerOnly: true },
];

export function SettingsTabs({ isManager }: { isManager: boolean }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => !t.managerOnly || isManager);
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = t.href === "/settings" ? pathname === "/settings" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
