/* Kanbai recovery worker — /sw.js is retired.
 *
 * Cloudflare force-caches this path with a multi-hour edge TTL regardless of
 * origin headers, so the real worker now lives at /service-worker (an
 * extensionless dynamic route Cloudflare never caches). Any client whose
 * browser still updates an old /sw.js registration to this script tears down
 * the old caches, unregisters itself, and reloads open windows so the fresh
 * page re-registers the new worker. One-shot by construction: after
 * unregister, the reloaded page is uncontrolled and registers /service-worker,
 * so this script never runs again.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("kanbai-")).map((k) => caches.delete(k)));
      // Claim first so client.navigate() below is allowed (a worker may only
      // navigate clients it controls), then drop the registration for good.
      await self.clients.claim();
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => {})));
    })(),
  );
});
