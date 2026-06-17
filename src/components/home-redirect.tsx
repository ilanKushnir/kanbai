"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { KanbaiMark } from "@/components/brand/Logo";

/** Signed-in landing: route to My Day on desktop, Notes on mobile. */
export function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    router.replace(mobile ? "/notes" : "/my-day");
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg">
      <KanbaiMark className="h-14 w-14 animate-pulse-soft" />
      <span className="text-sm text-fg-subtle">Opening Kanbai…</span>
    </div>
  );
}
