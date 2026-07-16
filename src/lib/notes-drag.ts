// Pure logic for the Notes drag-sort ("triage") mode.
//
// While a note is being dragged, schedule sections stop rendering their full
// contents and collapse into compact landing bands, so every destination is a
// short, thumb-sized drop target instead of a page-long list. Only the section
// the drag started from keeps its rows — for context and in-section reordering.
// Drop detection still runs on the section keys registered via useDroppable.

export type SectionMode = "rows" | "drop-zone";

export type SectionDisplay = {
  /** Whether the section body renders at all. */
  open: boolean;
  /** How an open section renders: full note rows, or a compact landing band. */
  mode: SectionMode;
};

export function sectionDisplay(opts: {
  key: string;
  dragging: boolean;
  /** Section key the active drag started from (null when not dragging). */
  dragOriginKey: string | null;
  collapsedKeys: ReadonlySet<string>;
  /** A text filter is active — sections with matches stay open, empty ones hide. */
  searching: boolean;
  /** Visible item count (notes + reflected tickets) under the current filter. */
  count: number;
}): SectionDisplay {
  const { key, dragging, dragOriginKey, collapsedKeys, searching, count } = opts;
  if (dragging) {
    if (key === dragOriginKey) return { open: true, mode: "rows" };
    return { open: true, mode: "drop-zone" };
  }
  if (searching) return { open: count > 0, mode: "rows" };
  return { open: !collapsedKeys.has(key), mode: "rows" };
}

/** The container key holding `id` — or `id` itself when it names a container. */
export function containerOf(map: Record<string, string[]>, id: string): string | null {
  if (id in map) return id;
  return Object.keys(map).find((k) => map[k].includes(id)) ?? null;
}

/**
 * Move `activeId` into `overId`'s container mid-drag. Hovering a container
 * itself (a collapsed landing band, or a list's tail area) appends to its end;
 * hovering a row inserts before that row. Returns null when nothing moves
 * (same container, or unknown ids) so callers can skip a state update.
 */
export function moveAcrossContainers(
  map: Record<string, string[]>,
  activeId: string,
  overId: string,
): Record<string, string[]> | null {
  const from = containerOf(map, activeId);
  const to = overId in map ? overId : containerOf(map, overId);
  if (!from || !to || from === to) return null;
  const overItems = map[to];
  const overIndex = overId in map ? overItems.length : Math.max(0, overItems.indexOf(overId));
  return {
    ...map,
    [from]: map[from].filter((id) => id !== activeId),
    [to]: [...overItems.slice(0, overIndex), activeId, ...overItems.slice(overIndex)],
  };
}
