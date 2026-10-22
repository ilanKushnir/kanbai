// A day's own order on Today. Pure, client-safe.
//
// A person can drag the tasks of Today and Tomorrow into the order they mean
// to do them, and (optionally) under Morning / Afternoon / Evening. That
// arrangement is a plan per day: [{ id, part }] in display order. It is
// personal and lives beside the items, so a ticket rescheduled away and back
// finds its old place, and nothing on the item itself changes.
//
// Rules:
//   • items the plan doesn't know yet come first, in the usual order (new
//     things show up where you'll see them), as "anytime";
//   • then the planned ones: anytime, morning, afternoon, evening, each in
//     plan order;
//   • the split into parts is only a view — hidden, the order stays.

export const DAY_PARTS = ["morning", "afternoon", "evening"] as const;
export type DayPart = (typeof DAY_PARTS)[number];
export type PlanEntry = { id: string; part: DayPart | null };
/** Plans by local day ("YYYY-MM-DD"). */
export type DayPlans = Record<string, PlanEntry[]>;

export const DAY_PART_LABEL: Record<DayPart, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

const partRank = (p: DayPart | null) => (p ? DAY_PARTS.indexOf(p) + 1 : 0);

const isPart = (v: unknown): v is DayPart => typeof v === "string" && (DAY_PARTS as readonly string[]).includes(v);

/** Read a stored plan; anything malformed is dropped, never thrown. */
export function parsePlan(raw: unknown): PlanEntry[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: PlanEntry[] = [];
  for (const e of v) {
    const id = (e as { id?: unknown })?.id;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    const part = (e as { part?: unknown }).part;
    out.push({ id, part: isPart(part) ? part : null });
  }
  return out;
}

/** The section's items in plan order, each with its part. `items` arrive in the usual order. */
export function arrangeDay<T extends { id: string }>(items: T[], plan: PlanEntry[] | undefined): { item: T; part: DayPart | null }[] {
  if (!plan?.length) return items.map((item) => ({ item, part: null }));
  const at = new Map(plan.map((e, i) => [e.id, i]));
  const fresh = items.filter((it) => !at.has(it.id)).map((item) => ({ item, part: null as DayPart | null }));
  const placed = items
    .filter((it) => at.has(it.id))
    .map((item) => ({ item, part: plan[at.get(item.id)!].part, i: at.get(item.id)! }))
    .sort((a, b) => partRank(a.part) - partRank(b.part) || a.i - b.i)
    .map(({ item, part }) => ({ item, part }));
  return [...fresh, ...placed];
}

/**
 * The plan to store after the section was rearranged: the section's new order,
 * then whatever the old plan held for items not on screen right now (done,
 * moved away, on someone else's shelf) — so they get their place back.
 */
export function nextPlan(section: PlanEntry[], previous: PlanEntry[] | undefined): PlanEntry[] {
  const ids = new Set(section.map((e) => e.id));
  return [...section, ...(previous ?? []).filter((e) => !ids.has(e.id))];
}

/**
 * Where a dragged item lands. `slots` is the section as it reads top to bottom
 * without the dragged item — rows and, when the split shows, part dividers —
 * and `before` is the slot it was dropped above (null = the end).
 *
 * With the split showing, the part is the divider above the drop. Without it,
 * the item joins its neighbour's part: the one above, else the one below.
 */
export type Slot = { kind: "item"; id: string; part: DayPart | null } | { kind: "part"; part: DayPart };

export function dropInto(slots: Slot[], id: string, before: string | null, split: boolean): PlanEntry[] {
  const key = (s: Slot) => (s.kind === "item" ? s.id : `part:${s.part}`);
  let at = before == null ? slots.length : slots.findIndex((s) => key(s) === before);
  if (at < 0) at = slots.length;

  let part: DayPart | null = null;
  if (split) {
    for (let i = at - 1; i >= 0; i--) {
      const s = slots[i];
      if (s.kind === "part") {
        part = s.part;
        break;
      }
    }
  } else {
    const above = slots.slice(0, at).reverse().find((s) => s.kind === "item");
    const below = slots.slice(at).find((s) => s.kind === "item");
    part = (above ?? below)?.part ?? null;
  }

  const entries: PlanEntry[] = [];
  slots.forEach((s, i) => {
    if (i === at) entries.push({ id, part });
    if (s.kind === "item") entries.push({ id: s.id, part: s.part });
  });
  if (at >= slots.length) entries.push({ id, part });
  return entries;
}

/** Move one item to a part (the end of it) — the menu's way, no dragging. */
export function moveToPart(section: PlanEntry[], id: string, part: DayPart | null): PlanEntry[] {
  const rest = section.filter((e) => e.id !== id);
  const lastOfPart = rest.reduce((n, e, i) => (partRank(e.part) <= partRank(part) ? i : n), -1);
  return [...rest.slice(0, lastOfPart + 1), { id, part }, ...rest.slice(lastOfPart + 1)];
}

/** The part of the day it is now (null at night, when no part is "now"). */
export function partOfDay(now: Date): DayPart | null {
  const h = now.getHours();
  if (h < 5) return null;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
