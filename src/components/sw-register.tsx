"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production for offline app-shell support.
 *
 * The worker is served from /service-worker (a dynamic route with no .js
 * extension) because Cloudflare force-caches /sw.js for hours regardless of
 * origin headers, which left installed PWAs running stale workers. Recovery:
 * any lingering registration whose script is /sw.js is unregistered here, the
 * new worker is registered with an immediate update() check, and the page
 * reloads once when a new worker takes control — only if it was already
 * controlled, so first-time visitors never reload and reloads can't loop.
 *
 * The app version is part of the script URL, so each release registers a new
 * worker whose cache name is derived from that version — old caches (and any
 * stale Next.js chunks in them) are purged on activate.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    const version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

    const hadController = Boolean(container.controller);
    let reloaded = false;
    const onControllerChange = () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    container.addEventListener("controllerchange", onControllerChange);

    (async () => {
      try {
        // Drop stale registrations still pointing at the Cloudflare-cached /sw.js.
        const registrations = await container.getRegistrations();
        for (const registration of registrations) {
          const worker = registration.active || registration.installing || registration.waiting;
          if (worker && new URL(worker.scriptURL).pathname.endsWith("/sw.js")) {
            await registration.unregister();
          }
        }
        const registration = await container.register(`/service-worker?v=${encodeURIComponent(version)}`);
        // Check for a newer worker right away; browsers otherwise wait for the
        // next navigation (or up to 24h) before re-fetching the script.
        registration.update().catch(() => {});
      } catch {
        // Best-effort: the app works without a worker.
      }
    })();

    return () => container.removeEventListener("controllerchange", onControllerChange);
  }, []);
  return null;
}
