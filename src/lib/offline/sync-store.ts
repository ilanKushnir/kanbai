"use client";

// Offline-first Today: the runtime half. One module-level store per tab:
//   • base   — the last server-confirmed Today data, persisted per user so the
//              list opens instantly (and offline) with what was last loaded;
//   • ops    — the outbox (see today-sync.ts), persisted, flushed in order
//              whenever the server is reachable;
//   • status — online / syncing / pending, for the connection indicator.
// Reachability is judged by real requests (navigator.onLine lies on iOS):
// a failed send or probe flips to offline, and a probe loop flips back.

import {
  applyOps,
  classifyResponse,
  confirmOp,
  opRequest,
  type NewTodayOp,
  type TodayData,
  type TodayOp,
} from "./today-sync";

const KEY_PREFIX = "kanbai:today:v1:";
const SEND_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 6_000;
/** Confirmed ops stay replayed this long, covering refreshes that raced them. */
const SETTLE_MS = 15_000;

type Persisted = { scope: string; base: TodayData | null; baseAt: number; ops: TodayOp[] };

export type SyncStatus = {
  online: boolean;
  syncing: boolean;
  pending: number;
  /** A send got 401: the session is gone; changes wait for a sign-in. */
  authNeeded: boolean;
  /** Server time (ms) of the data on screen; null before the first load. */
  baseAt: number | null;
  /** The page came from the offline cache and a fresh copy hasn't landed yet. */
  stale: boolean;
  /** When the outbox last drained (ms), for a brief "Synced" flash. */
  syncedAt: number;
};

export type SyncSnapshot = { status: SyncStatus; data: TodayData | null };

type SyncEvent = { type: "drained" } | { type: "refresh" } | { type: "rejected"; op: TodayOp; message: string };

let scope: string | null = null;
let base: TodayData | null = null;
let baseAt = 0;
let ops: TodayOp[] = [];
let settled: { op: TodayOp; until: number }[] = [];
const confirmedIds = new Set<string>();
let status: SyncStatus = {
  online: true,
  syncing: false,
  pending: 0,
  authNeeded: false,
  baseAt: null,
  stale: false,
  syncedAt: 0,
};
let snapshot: SyncSnapshot = { status, data: null };
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: SyncEvent) => void>();
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2_000;
let detach: (() => void) | null = null;

const hasWindow = () => typeof window !== "undefined";

function storage(): Storage | null {
  try {
    return hasWindow() ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load(scopeKey: string): Persisted | null {
  try {
    const raw = storage()?.getItem(KEY_PREFIX + scopeKey);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    return p && p.scope === scopeKey && Array.isArray(p.ops) ? p : null;
  } catch {
    return null;
  }
}

function persist() {
  if (!scope) return;
  try {
    storage()?.setItem(KEY_PREFIX + scope, JSON.stringify({ scope, base, baseAt, ops } satisfies Persisted));
  } catch {
    // Quota or private mode: the outbox still lives in memory for this session.
  }
}

function emit() {
  const now = Date.now();
  settled = settled.filter((s) => s.until > now);
  status = { ...status, pending: ops.length, baseAt: base ? baseAt : null };
  snapshot = { status, data: base ? applyOps(applyOps(base, settled.map((s) => s.op)), ops) : null };
  for (const l of listeners) l();
}

function fire(e: SyncEvent) {
  for (const l of eventListeners) l(e);
}

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  emit();
}

// ── public API ─────────────────────────────────────────────────────────────

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getSnapshot = () => snapshot;

export function onSyncEvent(fn: (e: SyncEvent) => void) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

/** Bind the store to a sync scope (user + workspace) and start syncing. Idempotent. */
export function startSync(scopeKey: string) {
  if (!hasWindow()) return;
  if (scope === scopeKey) return;
  detach?.();
  scope = scopeKey;
  const saved = load(scopeKey);
  base = saved?.base ?? null;
  baseAt = saved?.baseAt ?? 0;
  ops = saved?.ops ?? [];
  settled = [];
  confirmedIds.clear();
  status = { ...status, online: navigator.onLine !== false, authNeeded: false };
  detach = attach();
  emit();
  void flush();
}

/**
 * Server-rendered Today data arrived. Newer than what we hold → it becomes the
 * base (pending ops replay on top). Older → the page was served from the
 * offline cache: keep the saved copy and look for the network.
 */
export function ingestServer(scopeKey: string, data: TodayData, serverAt: number) {
  if (!hasWindow()) return;
  startSync(scopeKey);
  if (base && serverAt < baseAt) {
    markStale();
    return;
  }
  if (base && serverAt === baseAt) {
    if (Date.now() - serverAt > 60_000) markStale();
    return;
  }
  base = data;
  baseAt = serverAt;
  persist();
  const fresh = Date.now() - serverAt < 60_000;
  status = { ...status, stale: !fresh };
  emit();
  if (!fresh) markStale();
}

/** Queue an edit: applied on screen now, sent as soon as the server is reachable. */
export function enqueue(op: NewTodayOp) {
  if (!scope) return;
  const full = { ...op, opId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, at: new Date().toISOString() } as TodayOp;
  ops = [...ops, full];
  persist();
  emit();
  void flush();
}

/** Apply a change the server already confirmed (an online-only action). */
export function updateBase(fn: (b: TodayData) => TodayData) {
  if (!base) return;
  base = fn(base);
  persist();
  emit();
}

/** The page may be out of date (served from cache): probe, refresh when reachable. */
export function markStale() {
  if (!status.stale) setStatus({ stale: true });
  void probe().then((up) => {
    if (up && ops.length === 0) fire({ type: "refresh" });
  });
}

/** Retry now (the indicator's tap). */
export function retryNow() {
  retryDelay = 2_000;
  void probe().then((up) => {
    if (!up) return;
    if (ops.length) void flush();
    else fire({ type: "refresh" });
  });
}

/** Forget everything stored for every user on this device (sign-out). */
export function clearOfflineData() {
  const s = storage();
  if (s) {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith(KEY_PREFIX)) s.removeItem(k);
    }
  }
  detach?.();
  detach = null;
  scope = null;
  base = null;
  ops = [];
  settled = [];
  emit();
}

// ── network ────────────────────────────────────────────────────────────────

async function timedFetch(path: string, init: RequestInit, ms: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(path, { ...init, signal: ctl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function probe(): Promise<boolean> {
  try {
    const res = await timedFetch("/api/ping", {}, PROBE_TIMEOUT_MS);
    const up = res.status < 500;
    if (up && !status.online) {
      retryDelay = 2_000;
      setStatus({ online: true });
      if (ops.length) void flush();
    } else if (!up && status.online) setStatus({ online: false });
    return up;
  } catch {
    if (status.online) setStatus({ online: false });
    return false;
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = retryDelay;
  retryDelay = Math.min(30_000, retryDelay * 2);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void probe().then((up) => {
      if (!up) scheduleRetry();
    });
  }, delay);
}

async function flush() {
  if (flushing || !scope || ops.length === 0 || status.authNeeded) return;
  flushing = true;
  setStatus({ syncing: true });
  let sent = 0;
  try {
    while (ops.length) {
      const op = ops[0];
      const req = opRequest(op);
      let outcome: ReturnType<typeof classifyResponse>;
      let body: unknown = null;
      try {
        const res = await timedFetch(
          req.path,
          {
            method: req.method,
            headers: req.body ? { "content-type": "application/json" } : undefined,
            body: req.body ? JSON.stringify(req.body) : undefined,
          },
          SEND_TIMEOUT_MS,
        );
        outcome = classifyResponse(op, res.status);
        const text = await res.text();
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          // A 2xx that isn't our JSON is a proxy page, not the app: retry later.
          if (outcome === "ok" && res.status !== 204) outcome = "network";
        }
      } catch {
        outcome = "network";
      }

      if (outcome === "network") {
        setStatus({ online: false });
        scheduleRetry();
        break;
      }
      if (outcome === "auth") {
        setStatus({ authNeeded: true, online: true });
        break;
      }
      // Confirmed or rejected: either way this op is finished.
      confirmedIds.add(op.opId);
      ops = ops.filter((o) => o.opId !== op.opId);
      if (outcome === "ok" && base) {
        base = confirmOp(base, op, body);
        settled.push({ op, until: Date.now() + SETTLE_MS });
      }
      retryDelay = 2_000;
      status = { ...status, online: true };
      persist();
      emit();
      sent++;
      if (outcome === "rejected") {
        const message = (body as { error?: { message?: string } } | null)?.error?.message ?? "The server refused this change.";
        fire({ type: "rejected", op, message });
      }
    }
  } finally {
    flushing = false;
    const drained = ops.length === 0 && sent > 0;
    setStatus({ syncing: false, ...(drained ? { syncedAt: Date.now() } : {}) });
    if (drained) fire({ type: "drained" });
  }
}

function attach() {
  const onOnline = () => retryNow();
  const onOffline = () => setStatus({ online: false });
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (ops.length) void flush();
    else if (!status.online || status.stale) retryNow();
  };
  // Another tab changed the outbox: merge, never drop an op either side holds.
  const onStorage = (e: StorageEvent) => {
    if (!scope || e.key !== KEY_PREFIX + scope || !e.newValue) return;
    try {
      const other = JSON.parse(e.newValue) as Persisted;
      const known = new Set(ops.map((o) => o.opId));
      const extra = other.ops.filter((o) => !known.has(o.opId) && !confirmedIds.has(o.opId));
      if (other.base && other.baseAt > baseAt) {
        base = other.base;
        baseAt = other.baseAt;
      }
      if (extra.length) ops = [...ops, ...extra].sort((a, b) => a.at.localeCompare(b.at));
      emit();
      if (extra.length) void flush();
    } catch {
      // ignore malformed writes
    }
  };
  // While offline with nothing to send, keep checking quietly.
  const heartbeat = setInterval(() => {
    if (!status.online && document.visibilityState === "visible") void probe();
  }, 20_000);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(heartbeat);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
