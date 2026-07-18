import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import nextConfig from "../../next.config";

const sw = readFileSync("public/sw.js", "utf8");
const register = readFileSync("src/components/sw-register.tsx", "utf8");

test("service worker cache is versioned per release, not hardcoded", () => {
  // The cache name must derive from the ?v= registration param so each deploy
  // installs a fresh worker and cache — a fixed name serves stale chunks forever.
  assert.match(sw, /searchParams\.get\("v"\)/);
  assert.match(sw, /kanbai-\$\{VERSION\}/);
  assert.doesNotMatch(sw, /kanbai-v1/);
  // Old release caches are purged on activate.
  assert.match(sw, /k\.startsWith\("kanbai-"\) && k !== CACHE/);
});

test("registration pins the worker URL to the app release", () => {
  assert.match(register, /\/sw\.js\?v=/);
  assert.match(register, /NEXT_PUBLIC_APP_VERSION/);
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
