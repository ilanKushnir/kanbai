/* Kanbai service worker — offline app-shell.
 *
 * The page registers this script as /sw.js?v=<app version>, so every release
 * yields a new worker URL → fresh install → old kanbai-* caches purged on
 * activate. Never cache redirected responses: serving a `redirected: true`
 * response for a navigation makes WebKit fail the load ("This page could not
 * load" in iOS standalone). Auth-gated pages ("/", "/boards", …) redirect to
 * /login when logged out, so only /login is a safe navigation fallback.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `kanbai-${VERSION}`;

// Public, never-redirecting shell resources safe to precache.
const CORE = ["/login", "/icon.svg", "/manifest.webmanifest"];

const isCacheable = (res) => Boolean(res) && res.ok && !res.redirected && res.type === "basic";

const putInCache = (req, res) => {
  const copy = res.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(req, copy))
    .catch(() => {});
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        CORE.map((path) =>
          fetch(path, { cache: "no-cache" })
            .then((res) => (isCacheable(res) ? cache.put(path, res) : undefined))
            .catch(() => {}),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("kanbai-") && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never serve stale API data
  if (url.pathname === "/sw.js") return; // the worker script itself must stay fresh

  // Hashed build assets are immutable, so cache-first is safe across deploys —
  // a new release ships new URLs, and old entries die with the old cache.
  if (url.pathname.startsWith("/_next/")) {
    if (!url.pathname.startsWith("/_next/static/")) return; // /_next/image, RSC payloads, …
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (isCacheable(res)) putInCache(req, res);
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations: network-first so a deploy is picked up immediately. Fall back
  // to the cached copy of that page, then the cached /login shell, then a tiny
  // offline page. Fallbacks are full responses (never redirects), so no loops.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isCacheable(res)) putInCache(req, res);
          return res;
        })
        .catch(async () => {
          const cached = (await caches.match(req)) || (await caches.match("/login"));
          return (
            cached ||
            new Response(
              "<!doctype html><title>Offline</title><h1>Offline</h1><p>Kanbai needs a network connection.</p>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }),
    );
    return;
  }

  // Icons, fonts, manifest: stale-while-revalidate keeps them snappy while the
  // versioned cache guarantees a hard refresh at most one release behind.
  if (/\.(svg|png|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const refresh = fetch(req)
          .then((res) => {
            if (isCacheable(res)) putInCache(req, res);
            return res;
          })
          .catch(() => cached);
        return cached || refresh;
      }),
    );
  }
});
