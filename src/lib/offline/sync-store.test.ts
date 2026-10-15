import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type { TodayNote, TodayTicket } from "@/lib/today-model";
import type { TodayData } from "./today-sync";
import * as sync from "./sync-store";

// A minimal browser for the sync engine: localStorage, window/document events
// and a scriptable fetch that can "go offline".

const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
const noop = () => {};
Object.assign(globalThis, {
  window: { localStorage, addEventListener: noop, removeEventListener: noop },
  document: { visibilityState: "visible", addEventListener: noop, removeEventListener: noop },
});
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let offline = false;
let respond: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: {} });
globalThis.fetch = (async (path: string, init?: RequestInit) => {
  if (offline) throw new TypeError("Load failed");
  const call = { method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : undefined };
  if (path !== "/api/ping") calls.push(call);
  const r = path === "/api/ping" ? { status: 200, body: { ok: true } } : respond(call);
  return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;



const note = (id: string, extra: Partial<TodayNote> = {}): TodayNote => ({
  id,
  body: `note ${id}`,
  status: "inbox",
  scheduledDay: "2026-10-15",
  doneOn: null,
  priority: "none",
  position: 0,
  createdAt: "2026-10-15T08:00:00.000Z",
  updatedAt: "2026-10-15T08:00:00.000Z",
  assignedAgent: null,
  ticket: null,
  ...extra,
});
const data = (notes: TodayNote[], tickets: TodayTicket[] = []): TodayData => ({ notes, tickets, boards: [] });
const settle = () => new Promise((r) => setTimeout(r, 20));
const view = () => sync.getSnapshot().data!;

beforeEach(() => {
  sync.clearOfflineData();
  calls = [];
  offline = false;
  respond = () => ({ status: 200, body: {} });
});

test("offline: a completed task stays completed, is saved, and syncs once back online", async () => {
  sync.ingestServer("u:w", data([note("n1")]), Date.now());
  offline = true;
  sync.enqueue({ kind: "note.patch", id: "n1", body: { doneOn: "2026-10-15" }, optimistic: { doneOn: "2026-10-15" } });
  await settle();
  assert.equal(view().notes[0].doneOn, "2026-10-15", "shown as done right away");
  assert.equal(sync.getSnapshot().status.online, false);
  assert.equal(sync.getSnapshot().status.pending, 1);

  // App closed and reopened offline: the saved copy and the queue come back.
  const saved = store.get("kanbai:today:v1:u:w")!;
  sync.clearOfflineData();
  store.set("kanbai:today:v1:u:w", saved);
  sync.startSync("u:w");
  await settle();
  assert.equal(view().notes[0].doneOn, "2026-10-15");
  assert.equal(sync.getSnapshot().status.pending, 1);

  offline = false;
  respond = () => ({ status: 200, body: { note: { ...note("n1"), doneOn: "2026-10-15" } } });
  sync.retryNow();
  await settle();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["PATCH /api/notes/n1"]);
  assert.equal(sync.getSnapshot().status.pending, 0);
  assert.equal(view().notes[0].doneOn, "2026-10-15");
});

test("offline adds go up in order with their client ids (create, then edit)", async () => {
  sync.ingestServer("u:w", data([]), Date.now());
  offline = true;
  sync.enqueue({ kind: "note.create", note: note("cnew"), body: { body: "note cnew", scheduledDay: "2026-10-15" } });
  sync.enqueue({ kind: "note.patch", id: "cnew", body: { doneOn: "2026-10-15" }, optimistic: { doneOn: "2026-10-15" } });
  await settle();
  assert.equal(view().notes.length, 1);
  assert.equal(view().notes[0].doneOn, "2026-10-15");

  offline = false;
  respond = (c) => ({ status: c.method === "POST" ? 201 : 200, body: { note: note("cnew", c.method === "PATCH" ? { doneOn: "2026-10-15" } : {}) } });
  sync.retryNow();
  await settle();
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["POST /api/notes", "PATCH /api/notes/cnew"],
  );
  assert.equal((calls[0].body as { id: string }).id, "cnew");
  assert.equal(sync.getSnapshot().status.pending, 0);
});

test("a server error keeps the op queued; a refusal drops it; deleting the already-deleted is fine", async () => {
  sync.ingestServer("u:w", data([note("n1"), note("n2")]), Date.now());
  respond = () => ({ status: 502 });
  sync.enqueue({ kind: "note.patch", id: "n1", body: { priority: "high" }, optimistic: { priority: "high" } });
  await settle();
  assert.equal(sync.getSnapshot().status.pending, 1, "gateway error = retry later");
  assert.equal(sync.getSnapshot().status.online, false);

  const events: string[] = [];
  const off = sync.onSyncEvent((e) => events.push(e.type));
  respond = (c) => (c.method === "DELETE" ? { status: 404 } : { status: 422, body: { error: { message: "nope" } } });
  sync.enqueue({ kind: "note.delete", id: "n2" });
  sync.retryNow();
  await settle();
  off();
  assert.equal(sync.getSnapshot().status.pending, 0);
  assert.ok(events.includes("rejected"));
  assert.ok(events.includes("drained"));
  assert.deepEqual(view().notes.map((n) => n.id), ["n1"]);
});

test("a page from the offline cache never overwrites newer saved data", async () => {
  const t = Date.now();
  sync.ingestServer("u:w", data([note("n1", { body: "newer" })]), t);
  sync.ingestServer("u:w", data([note("n1", { body: "older cached page" })]), t - 3_600_000);
  assert.equal(view().notes[0].body, "newer");
  assert.equal(sync.getSnapshot().status.stale, true);
  // A fresh render wins and clears the stale flag.
  sync.ingestServer("u:w", data([note("n1", { body: "fresh" })]), t + 1000);
  assert.equal(view().notes[0].body, "fresh");
  assert.equal(sync.getSnapshot().status.stale, false);
});

test("queued edits replay on top of a fresh server load", async () => {
  sync.ingestServer("u:w", data([note("n1")]), Date.now());
  offline = true;
  sync.enqueue({ kind: "note.patch", id: "n1", body: { body: "edited offline" }, optimistic: { body: "edited offline" } });
  await settle();
  sync.ingestServer("u:w", data([note("n1", { body: "from server" })]), Date.now() + 5);
  assert.equal(view().notes[0].body, "edited offline");
});

test("sign-out clears everything stored on the device", () => {
  sync.ingestServer("u:w", data([note("n1")]), Date.now());
  assert.ok([...store.keys()].some((k) => k.startsWith("kanbai:today:")));
  sync.clearOfflineData();
  assert.ok(![...store.keys()].some((k) => k.startsWith("kanbai:today:")));
  assert.equal(sync.getSnapshot().data, null);
});
