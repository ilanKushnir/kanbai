import * as React from "react";
import { Logo } from "@/components/brand/Logo";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl bg-brand-gradient"
      />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo markClassName="h-9 w-9" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-fg-muted">{footer}</div>}
      </div>
    </div>
  );
}
