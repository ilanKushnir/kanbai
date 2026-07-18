"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production for offline app-shell support.
 * The app version is part of the script URL, so each release registers a new
 * worker whose cache name is derived from that version — old caches (and any
 * stale Next.js chunks in them) are purged on activate.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`).catch(() => {});
  }, []);
  return null;
}
