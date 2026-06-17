import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireSystemAdmin } from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";
import { ToastProvider } from "@/components/ui/toast";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSystemAdmin();
  return (
    <ToastProvider>
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-3">
          <Logo markClassName="h-7 w-7" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-soft-fg">
            <ShieldCheck className="h-3.5 w-3.5" /> Global admin
          </span>
        </div>
        <Link href="/my-day" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back to Kanbai
        </Link>
      </header>
      <main>{children}</main>
    </div>
    </ToastProvider>
  );
}
