// Column sub-states are stored as a JSON array of trimmed names on Column.subStates.
// Pure helpers so both the server (services, routes) and client can normalize them.

export const MAX_SUBSTATES = 8;

/** Parse the stored JSON blob into a clean, de-duped list of sub-state names. */
export function parseSubStates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
      if (typeof v !== "string") continue;
      const name = v.trim().slice(0, 24);
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        out.push(name);
      }
    }
    return out.slice(0, MAX_SUBSTATES);
  } catch {
    return [];
  }
}

/** Serialize a list back to the stored form (null when empty). */
export function stringifySubStates(names: string[]): string | null {
  const clean = parseSubStates(JSON.stringify(names));
  return clean.length ? JSON.stringify(clean) : null;
}
