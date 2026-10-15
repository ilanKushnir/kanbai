import * as React from "react";
import { ThemedArt } from "@/components/ui/themed-art";
import { Logo } from "@/components/brand/Logo";
import { POWERED_BY } from "@/lib/version";

/**
 * Sign-in / sign-up frame: the form on paper, with the morning-desk
 * illustration beside it on wide screens and above it on phones.
 */
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
    <div className="kb-paper relative flex min-h-dvh flex-col md:flex-row">
      {/* Art */}
      <div className="kb-auth-art relative h-56 w-full shrink-0 overflow-hidden md:h-auto md:w-[46%] md:max-w-[640px]">
        <ThemedArt name="login" sizes="(min-width: 768px) 46vw, 100vw" className="animate-hero-in object-cover" />
        <div className="kb-auth-art-fade absolute inset-0" aria-hidden />
      </div>

      {/* Form */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-6 md:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <Logo markClassName="h-9 w-9" />
          </div>
          <h1 className="font-display text-[2rem] font-medium leading-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[0.95rem] text-fg-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-5 text-sm text-fg-muted">{footer}</div>}
          <div className="mt-10 text-xs text-fg-subtle">powered by {POWERED_BY}</div>
        </div>
      </div>
    </div>
  );
}
