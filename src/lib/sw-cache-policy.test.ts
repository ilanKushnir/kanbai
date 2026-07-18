import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import nextConfig from "../../next.config";
import { GET as getServiceWorker } from "../app/service-worker/route";

const sw = readFileSync("src/lib/service-worker.js", "utf8");
const legacySw = readFileSync("public/sw.js", "utf8");
const register = readFileSync("src/components/sw-register.tsx", "utf8");
const rootLayout = readFileSync("src/app/layout.tsx", "utf8");

test("service worker cache is versioned per release, not hardcoded", () => {
  // The cache name must derive from the ?v= registration param so each deploy
  // installs a fresh worker and cache — a fixed name serves stale chunks forever.
  assert.match(sw, /searchParams\.get\("v"\)/);
  assert.match(sw, /kanbai-\$\{VERSION\}/);
  assert.doesNotMatch(sw, /kanbai-v1/);
  // Old release caches are purged on activate.
  assert.match(sw, /k\.startsWith\("kanbai-"\) && k !== CACHE/);
});

test("/service-worker route serves the worker script Cloudflare cannot cache", async () => {
  // Cloudflare force-caches *.js paths regardless of origin headers, so the
  // worker must come from an extensionless dynamic route with anti-cache
  // headers — and still be valid JS with a root scope.
  const res = getServiceWorker();
  assert.match(res.headers.get("Content-Type") ?? "", /application\/javascript/);
  const cacheControl = res.headers.get("Cache-Control") ?? "";
  for (const directive of ["no-store", "no-cache", "must-revalidate"]) {
    assert.ok(cacheControl.includes(directive), `Cache-Control must include ${directive}`);
  }
  assert.equal(res.headers.get("Pragma"), "no-cache");
  assert.equal(res.headers.get("Expires"), "0");
  assert.equal(res.headers.get("Service-Worker-Allowed"), "/");
  assert.equal(await res.text(), sw);
});

test("registration targets /service-worker and recovers stale /sw.js clients", () => {
  assert.match(register, /register\(`\/service-worker\?v=/);
  assert.match(register, /NEXT_PUBLIC_APP_VERSION/);
  assert.doesNotMatch(register, /register\([^)]*sw\.js/);
  // Clients stuck on the Cloudflare-cached /sw.js must be unregistered, and a
  // fresh update check kicked off immediately.
  assert.match(register, /getRegistrations\(\)/);
  assert.match(register, /\.pathname\.endsWith\("\/sw\.js"\)/);
  assert.match(register, /\.unregister\(\)/);
  assert.match(register, /\.update\(\)/);
  // The controllerchange reload must be one-shot and skip uncontrolled pages,
  // or a claiming worker triggers a reload loop / reloads first-time visitors.
  assert.match(register, /controllerchange/);
  assert.match(register, /hadController/);
  assert.match(register, /reloaded = true/);
});

test("worker registers from the root layout so /login installs it too", () => {
  assert.match(rootLayout, /<ServiceWorkerRegister \/>/);
});

test("legacy /sw.js is a self-destruct worker, not an app-shell cache", () => {
  // Anything Cloudflare still serves from /sw.js must only tear down: purge
  // kanbai-* caches, unregister, and reload clients to pick up /service-worker.
  assert.match(legacySw, /self\.skipWaiting\(\)/);
  assert.match(legacySw, /k\.startsWith\("kanbai-"\)/);
  assert.match(legacySw, /registration\.unregister\(\)/);
  assert.match(legacySw, /client\.navigate\(client\.url\)/);
  assert.doesNotMatch(legacySw, /addEventListener\("fetch"/);
  assert.doesNotMatch(legacySw, /cache\.put/);
});

test("service worker never caches or serves redirected responses", () => {
  // cache.addAll follows redirects and stores redirected responses; WebKit then
  // fails navigations served from them ("This page could not load" on iOS).
  assert.doesNotMatch(sw, /addAll/);
  assert.match(sw, /!res\.redirected/);
  // Auth-gated pages redirect to /login when logged out, so they must not be
  // precached and "/" must not be the navigation fallback.
  assert.doesNotMatch(sw, /caches\.match\("\/"\)/);
  assert.match(sw, /caches\.match\("\/login"\)/);
  for (const path of sw.match(/const CORE = \[([^\]]*)\]/)![1].matchAll(/"([^"]+)"/g)) {
    assert.notEqual(path[1], "/", "CORE must not precache auth-redirecting pages");
  }
});

test("navigations are network-first and only immutable build assets are cache-first", () => {
  // Cache-first is only safe for content-hashed /_next/static assets.
  assert.match(sw, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.doesNotMatch(sw, /css\|js/); // old blanket cache-first pattern for any js/css
  // The worker script paths themselves must never be intercepted.
  assert.match(sw, /url\.pathname === "\/service-worker"/);
});

test("sw.js and manifest are served with no-cache headers", async () => {
  const headers = await nextConfig.headers!();
  for (const source of ["/sw.js", "/manifest.webmanifest"]) {
    const rule = headers.find((h) => h.source === source);
    assert.ok(rule, `missing headers rule for ${source}`);
    const cc = rule.headers.find((h) => h.key === "Cache-Control");
    assert.ok(cc && /no-cache/.test(cc.value), `${source} must be no-cache`);
  }
});

test("app version is inlined for the client so the SW URL tracks releases", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(nextConfig.env?.NEXT_PUBLIC_APP_VERSION, pkg.version);
});
