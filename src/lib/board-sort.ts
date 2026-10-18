// Sorting a board column — pure, client-safe. Each column shows its cards in
// one of a few orders; ties always fall back to the hand-made (manual) order,
// so a sort never shuffles cards that compare equal.

import { PRIORITY_META, type Priority } from "./constants";

export type SortKey = "due" | "priority" | "newest" | "updated" | "completed" | "manual";

export const SORT_OPTIONS: { key: SortKey; label: string; hint: string; short: string }[] = [
  { key: "due", label: "Due date", hint: "Soonest first, then priority", short: "Due" },
  { key: "priority", label: "Priority", hint: "Highest first, then due date", short: "Priority" },
  { key: "newest", label: "Newest", hint: "Most recently created first", short: "Newest" },
  { key: "updated", label: "Recently updated", hint: "Last touched first", short: "Updated" },
  { key: "completed", label: "Recently completed", hint: "Latest finished first", short: "Completed" },
  { key: "manual", label: "Manual", hint: "Your own order — drag to arrange", short: "Manual" },
];

/** What a column shows when nothing was chosen: done columns by completion, the rest by due date. */
export function defaultSort(col: { isDone: boolean }): SortKey {
  return col.isDone ? "completed" : "due";
}

/** Per-board choice: one board-wide order, and per-column overrides on top. */
export type BoardSort = { all?: SortKey; cols: Record<string, SortKey> };

export function columnSort(pref: BoardSort, col: { id: string; isDone: boolean }): SortKey {
  const own = pref.cols[col.id];
  if (own) return own;
  if (pref.all) return col.isDone && pref.all === "due" ? "completed" : pref.all;
  return defaultSort(col);
}

type Sortable = { dueDate: string | null; priority: string; createdAt: string; updatedAt: string; completedAt: string | null };

const rank = (p: string) => PRIORITY_META[p as Priority]?.rank ?? 0;
/** The local calendar day of a due date: cards due the same day tie, and priority decides. */
const dueDay = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
};
const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Ascending by a time where missing sorts last. */
function byTimeAsc(a: string | null, b: string | null) {
  const ta = time(a);
  const tb = time(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}
const byTimeDesc = (a: string | null, b: string | null) => {
  const ta = time(a);
  const tb = time(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
};

export function compareBy(key: SortKey, a: Sortable, b: Sortable): number {
  switch (key) {
    case "due":
      return byTimeAsc(dueDay(a.dueDate), dueDay(b.dueDate)) || rank(b.priority) - rank(a.priority) || byTimeAsc(a.dueDate, b.dueDate);
    case "priority":
      return rank(b.priority) - rank(a.priority) || byTimeAsc(dueDay(a.dueDate), dueDay(b.dueDate));
    case "newest":
      return byTimeDesc(a.createdAt, b.createdAt);
    case "updated":
      return byTimeDesc(a.updatedAt, b.updatedAt);
    case "completed":
      return byTimeDesc(a.completedAt, b.completedAt) || byTimeDesc(a.updatedAt, b.updatedAt);
    case "manual":
      return 0;
  }
}

/** The ids in display order; unknown ids and ties keep their manual place. */
export function sortIds(ids: string[], byId: Record<string, Sortable | undefined>, key: SortKey): string[] {
  if (key === "manual") return ids;
  return ids
    .map((id, i) => ({ id, i, t: byId[id] }))
    .sort((x, y) => (x.t && y.t ? compareBy(key, x.t, y.t) : 0) || x.i - y.i)
    .map((x) => x.id);
}

export function parseBoardSort(raw: string | null): BoardSort {
  const keys = new Set(SORT_OPTIONS.map((o) => o.key));
  try {
    const v = raw ? JSON.parse(raw) : null;
    const cols: Record<string, SortKey> = {};
    for (const [k, s] of Object.entries((v?.cols ?? {}) as Record<string, unknown>)) if (keys.has(s as SortKey)) cols[k] = s as SortKey;
    return { all: keys.has(v?.all) ? v.all : undefined, cols };
  } catch {
    return { cols: {} };
  }
}
