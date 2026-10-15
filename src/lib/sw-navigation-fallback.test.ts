import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

/**
 * Behavioral tests for the service worker's navigation fallback, running the
 * real src/lib/service-worker.js in a mock SW scope.
 *
 * WebKit refuses to complete a navigation when the worker responds with a
 * `redirected: true` response ("Response served by service worker has
 * redirections" — surfaced as "This page couldn't load" in iOS standalone).
 * Workers ≤ v0.7.6 stored such responses (addAll precache + unguarded
 * cache.put of navigation responses), so the fallback must never SERVE an
 * unsafe cached entry, even though the current worker never writes one.
 */

const swSource = readFileSync("src/lib/service-worker.js", "utf8");

type Listeners = Record<string, (event: unknown) => void>;

function loadWorker(opts: {
  fetchImpl: (input: unknown, init?: unknown) => Promise<Response>;
  cacheEntries: Record<string, Response | undefined>;
  navTimeoutMs?: number;
}): Listeners {
  const listeners: Listeners = {};
  const cache = { put: async () => undefined, keys: async () => [] };
  const sandbox = {
    self: {
      location: { href: "https://kanbai.test/service-worker?v=test", origin: "https://kanbai.test" },
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners[type] = fn;
      },
      skipWaiting: () => undefined,
      clients: { claim: async () => undefined },
      registration: {},
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (key: unknown, matchOpts?: { ignoreSearch?: boolean }) => {
        const url = new URL(typeof key === "string" ? key : (key as Request).url, "https://kanbai.test");
        const path = matchOpts?.ignoreSearch ? url.pathname : url.pathname + url.search;
        return opts.cacheEntries[path];
      },
    },
    fetch: opts.fetchImpl,
    URL,
    Response,
    Promise,
    console,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, opts.navTimeoutMs ?? ms),
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);
  return listeners;
}

/** A stored cache entry with controlled `redirected`/`type` flags. */
function cachedResponse(body: string, { redirected = false } = {}): Response {
  const res = new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
  Object.defineProperty(res, "redirected", { value: redirected });
  Object.defineProperty(res, "type", { value: "basic" });
  Object.defineProperty(res, "url", { value: redirected ? "https://kanbai.test/login" : "https://kanbai.test/notes" });
  return res;
}

function navigationRequest(path: string) {
  return {
    method: "GET",
    url: `https://kanbai.test${path}`,
    mode: "navigate",
    headers: new Headers({ accept: "text/html" }),
  };
}

async function respondToNavigation(
  listeners: Listeners,
  path: string,
): Promise<Response> {
  let responded: Promise<Response> | undefined;
  listeners.fetch({
    request: navigationRequest(path),
    respondWith(p: Promise<Response>) {
      responded = Promise.resolve(p);
    },
  });
  assert.ok(responded, "worker must respondWith for navigations");
  return responded;
}

const offlineFetch = async () => {
  throw new TypeError("Load failed"); // WebKit's network-failure rejection
};

test("offline navigation never serves a redirected cache entry (WebKit-fatal)", async () => {
  // Legacy-worker state: /notes holds a followed-redirect response.
  const listeners = loadWorker({
    fetchImpl: offlineFetch,
    cacheEntries: { "/notes": cachedResponse("<html>login-after-redirect</html>", { redirected: true }) },
  });
  const res = await respondToNavigation(listeners, "/notes");
  assert.equal(
    res.redirected ?? false,
    false,
    "serving a redirected response fails the navigation in WebKit — must fall through to a safe response",
  );
});

test("offline navigation with a poisoned page entry serves the offline screen, pointing to Today", async () => {
  const listeners = loadWorker({
    fetchImpl: offlineFetch,
    cacheEntries: {
      "/notes": cachedResponse("poisoned", { redirected: true }),
      "/login": cachedResponse("<html>login shell</html>"),
    },
  });
  const res = await respondToNavigation(listeners, "/notes");
  assert.equal(res.redirected ?? false, false);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /href="\/today"/);
});

test("offline, any /today link opens the saved Today", async () => {
  const listeners = loadWorker({ fetchImpl: offlineFetch, cacheEntries: { "/today": cachedResponse("<html>today</html>") } });
  const res = await respondToNavigation(listeners, "/today?focus=abc");
  assert.equal(await res.text(), "<html>today</html>");
});

test("offline, the root sends you to the saved Today with a plain redirect", async () => {
  const listeners = loadWorker({ fetchImpl: offlineFetch, cacheEntries: { "/today": cachedResponse("<html>today</html>") } });
  const res = await respondToNavigation(listeners, "/");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://kanbai.test/today");
  assert.equal(res.redirected, false);
});

test("a hanging network shows the saved page after the timeout", async () => {
  const listeners = loadWorker({
    fetchImpl: () => new Promise<Response>(() => {}), // lie-fi: never answers
    cacheEntries: { "/today": cachedResponse("<html>saved today</html>") },
    navTimeoutMs: 10,
  });
  const res = await respondToNavigation(listeners, "/today");
  assert.equal(await res.text(), "<html>saved today</html>");
});

test("a slow network with nothing saved keeps waiting for the page", async () => {
  const fresh = cachedResponse("<html>fresh</html>");
  const listeners = loadWorker({
    fetchImpl: () => new Promise<Response>((resolve) => setTimeout(() => resolve(fresh), 40)),
    cacheEntries: {},
    navTimeoutMs: 5,
  });
  const res = await respondToNavigation(listeners, "/boards");
  assert.equal(res, fresh);
});

test("offline navigation serves a clean cached copy of the page", async () => {
  const listeners = loadWorker({
    fetchImpl: offlineFetch,
    cacheEntries: { "/notes": cachedResponse("<html>notes</html>") },
  });
  const res = await respondToNavigation(listeners, "/notes");
  assert.equal(await res.text(), "<html>notes</html>");
});

test("offline navigation with no safe cache entry serves the offline stub", async () => {
  const listeners = loadWorker({ fetchImpl: offlineFetch, cacheEntries: {} });
  const res = await respondToNavigation(listeners, "/notes");
  assert.equal(res.status, 503);
  assert.match(await res.text(), /Offline/);
});

test("online navigation passes the network response through untouched", async () => {
  const networkRes = cachedResponse("<html>fresh</html>");
  const listeners = loadWorker({ fetchImpl: async () => networkRes, cacheEntries: {} });
  const res = await respondToNavigation(listeners, "/notes");
  assert.equal(res, networkRes);
});
