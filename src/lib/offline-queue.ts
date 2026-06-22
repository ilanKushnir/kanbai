"use client";

const OFFLINE_MUTATION_KEY = "kanbai-offline-mutations";

export type OfflineMutation = {
  kind: "note.patch";
  id: string;
  body: Record<string, unknown>;
  enqueuedAt?: string;
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getOfflineMutations(): OfflineMutation[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(OFFLINE_MUTATION_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as OfflineMutation[]) : [];
  } catch {
    return [];
  }
}

export function setOfflineMutations(items: OfflineMutation[]) {
  storage()?.setItem(OFFLINE_MUTATION_KEY, JSON.stringify(items));
}

export function clearOfflineMutations() {
  storage()?.removeItem(OFFLINE_MUTATION_KEY);
}

export function enqueueOfflineMutation(item: OfflineMutation) {
  setOfflineMutations([...getOfflineMutations(), { ...item, enqueuedAt: item.enqueuedAt ?? new Date().toISOString() }]);
}
