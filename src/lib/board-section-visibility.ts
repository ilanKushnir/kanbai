/** Shared board-section visibility and ordering rules.
 *
 * Ticket ids are stored oldest → newest because newly-created and moved cards
 * append at the end of a section. The board presents the newest cards first,
 * then lets older cards come in behind a per-section Show more control.
 */
export function isDenseSection(total: number, limit: number, slack: number): boolean {
  return total > limit + slack;
}

export function visibleNewestFirstIds(ids: string[], visibleCount: number): string[] {
  return ids.slice(-visibleCount).reverse();
}

export function nextVisibleCount(current: number, total: number, batchSize: number): number {
  return Math.min(total, current + batchSize);
}

/**
 * Reorder within an oldest→newest backing array using newest-first visual semantics.
 * Moving a card over another card places it at that visual slot, so the persisted
 * order still matches what the user saw after reversing back to newest-first.
 */
export function moveInNewestFirstOrder(ids: string[], activeId: string, overId: string): string[] {
  const visual = [...ids].reverse();
  const oldIndex = visual.indexOf(activeId);
  const newIndex = visual.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return ids;

  const next = [...visual];
  const [item] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, item);
  return next.reverse();
}

/** Insert into an oldest→newest array at the visual position of overId. */
export function insertInNewestFirstOrder(ids: string[], activeId: string, overId: string): string[] {
  const withoutActive = ids.filter((id) => id !== activeId);
  const overIndex = withoutActive.indexOf(overId);
  if (overIndex === -1) return [...withoutActive, activeId];
  return [...withoutActive.slice(0, overIndex + 1), activeId, ...withoutActive.slice(overIndex + 1)];
}
