import assert from "node:assert/strict";
import test from "node:test";

import { enqueueOfflineMutation, getOfflineMutations, clearOfflineMutations } from "@/lib/offline-queue";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  },
  configurable: true,
});

test("offline mutation queue preserves note updates in FIFO order until sync", () => {
  clearOfflineMutations();
  enqueueOfflineMutation({ kind: "note.patch", id: "n1", body: { doneOn: "2026-06-21" } });
  enqueueOfflineMutation({ kind: "note.patch", id: "n1", body: { body: "edited offline" } });
  assert.deepEqual(getOfflineMutations().map((item) => item.kind), ["note.patch", "note.patch"]);
  assert.deepEqual(getOfflineMutations().map((item) => item.id), ["n1", "n1"]);
});
