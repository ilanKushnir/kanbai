/* Kanbai service worker — offline app-shell.
 *
 * Served by the /service-worker route (not from /public): Cloudflare
 * force-caches *.js paths like /sw.js for hours regardless of origin headers,
 * so the worker script must live on an extensionless dynamic route to stay
 * fresh. The page registers it as /service-worker?v=<app version>, so every
 * release yields a new worker URL → fresh install → old kanbai-* caches purged
 * on activate. Never cache redirected responses: serving a `redirected: true`
 * response for a navigation makes WebKit fail the load ("This page could not
 * load" in iOS standalone).
 *
 * Offline: every page loaded online is saved; offline, a page opens from its
 * saved copy (Today, the home screen's start page, is the one that matters —
 * the app keeps its data and queued edits in localStorage, see lib/offline).
 * A page never saved gets a small offline screen pointing back to Today.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `kanbai-${VERSION}`;

// Public, never-redirecting shell resources safe to precache.
const CORE = ["/login", "/icon-192.png", "/manifest.webmanifest"];

const isCacheable = (res) => Boolean(res) && res.ok && !res.redirected && res.type === "basic";

const putInCache = (req, res) => {
  const copy = res.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(req, copy))
    .catch(() => {});
};

// How long a navigation waits for the network before showing the saved page.
const NAV_TIMEOUT_MS = 4000;

// Serve only clean cached copies: workers ≤ v0.7.6 stored followed redirects
// under page URLs, and WebKit fails a navigation served such a response
// ("Response served by service worker has redirections" — "This page couldn't
// load" in iOS standalone). Guard reads, not just writes.
const safe = (res) => (isCacheable(res) ? res : undefined);
const match = (key, opts) => caches.match(key, { ignoreVary: true, ...opts });

async function navigate(req, url) {
  const network = fetch(req).then((res) => {
    if (isCacheable(res)) putInCache(req, res);
    return res;
  });
  network.catch(() => {}); // a late failure after the saved page was served
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== "timeout") return first;
    // Slow network: show the saved page now if there is one, else keep waiting.
    const saved = await savedPage(url);
    return saved || (await network);
  } catch {
    const saved = await savedPage(url);
    if (saved) return saved;
    // The app's home works offline: send "/" there when Today is saved.
    if (url.pathname === "/" && safe(await match("/today", { ignoreSearch: true }))) {
      return Response.redirect(new URL("/today", self.location.origin).href, 302);
    }
    return offlinePage(url);
  }
}

async function savedPage(url) {
  const exact = safe(await match(url.href));
  if (exact) return exact;
  // Today is the offline home: any /today?… link opens the saved Today.
  if (url.pathname === "/today") return safe(await match("/today", { ignoreSearch: true }));
  return undefined;
}

function offlinePage(url) {
  const home = url.pathname.startsWith("/today") ? "" : '<a class="btn" href="/today">Open Today</a>';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
      `<meta name="color-scheme" content="light dark"><title>Offline · Kanbai</title><style>` +
      `:root{--bg:#f2f2f2;--fg:#111;--muted:#666;--line:#ddd}` +
      `@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#f2f2f2;--muted:#999;--line:#262626}}` +
      `html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif}` +
      `main{min-height:100%;display:grid;place-content:center;gap:.75rem;padding:2rem;text-align:center}` +
      `h1{margin:0;font-size:1.5rem;font-weight:600}p{margin:0;color:var(--muted)}` +
      `.row{display:flex;gap:.5rem;justify-content:center;margin-top:.75rem}` +
      `.btn,button{font:inherit;padding:.5rem 1rem;border-radius:.75rem;border:1px solid var(--line);background:transparent;color:var(--fg);text-decoration:none;cursor:pointer}` +
      `.dot{width:.5rem;height:.5rem;border-radius:50%;background:#e8432a;margin:0 auto}` +
      `</style></head><body><main><div class="dot"></div><h1>Offline</h1>` +
      `<p>This page isn't saved on this device yet. It opens as soon as you're back online.</p>` +
      `<div class="row">${home}<button onclick="location.reload()">Try again</button></div></main></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

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
  // Worker scripts themselves must stay fresh (legacy /sw.js and the current route).
  if (url.pathname === "/sw.js" || url.pathname === "/service-worker") return;

  // Hashed build assets are immutable, so cache-first is safe across deploys —
  // a new release ships new URLs, and old entries die with the old cache.
  // Optimized images (board covers, Today's art): stale-while-revalidate, so
  // the saved pages keep their pictures offline.
  if (url.pathname === "/_next/image") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.pathname.startsWith("/_next/")) {
    if (!url.pathname.startsWith("/_next/static/")) return; // RSC payloads, …
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

  // Navigations: network-first so a deploy is picked up immediately, but
  // never stuck behind a dead or crawling connection: after NAV_TIMEOUT_MS the
  // last saved copy of the page is shown (the app then syncs and refreshes on
  // its own once the network answers). Fallbacks are full responses (never
  // followed redirects), so no loops.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(navigate(req, url));
    return;
  }

  // Icons, art, fonts, manifest: stale-while-revalidate keeps them snappy while
  // the versioned cache guarantees a hard refresh at most one release behind.
  if (/\.(svg|png|jpe?g|webp|avif|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const refresh = fetch(req)
      .then((res) => {
        if (isCacheable(res)) putInCache(req, res);
        return res;
      })
      .catch(() => cached || Response.error());
    return cached || refresh;
  });
}
