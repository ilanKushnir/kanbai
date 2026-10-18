// Subtasks — one shape for both kinds of task. Tickets keep theirs in the
// Subtask table; a simple task (note) keeps its list inline, as JSON, so it
// travels with the task through the offline outbox. Pure and client-safe.

export type SubtaskItem = { id: string; title: string; completed: boolean };

export const MAX_SUBTASKS = 50;
export const MAX_SUBTASK_TITLE = 200;

/** A note's stored list; anything malformed reads as empty. */
export function parseSubtasks(raw: string | null | undefined): SubtaskItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((s) => s && typeof s.id === "string" && typeof s.title === "string")
      .map((s) => ({ id: s.id, title: s.title, completed: s.completed === true }));
  } catch {
    return [];
  }
}

export function subtaskId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "st" + Array.from(bytes, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);
}

export function newSubtasks(titles: string[]): SubtaskItem[] {
  return titles
    .map((t) => t.trim().slice(0, MAX_SUBTASK_TITLE))
    .filter(Boolean)
    .map((title) => ({ id: subtaskId(), title, completed: false }));
}

export function subtaskProgress(list: { completed: boolean }[]) {
  const done = list.filter((s) => s.completed).length;
  return { done, total: list.length, open: list.length - done };
}

const CHECK_LINE = /^\s*(?:[-*+]|\d+[.)])\s*\[( |x|X)\]\s*(.+?)\s*$/;

/**
 * Markdown checklist lines ("- [ ] Buy a SIM") inside a task's text become
 * real subtasks; the text keeps everything else. A text that is nothing but a
 * checklist stays as written (there'd be no title left).
 */
export function liftChecklist(text: string): { text: string; items: { title: string; completed: boolean }[] } {
  const items: { title: string; completed: boolean }[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const m = CHECK_LINE.exec(line);
    if (m) items.push({ title: m[2].slice(0, MAX_SUBTASK_TITLE), completed: m[1] !== " " });
    else kept.push(line);
  }
  if (!items.length) return { text, items };
  // A lead-in line that only introduced the list ("First:") goes with it.
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (kept.length > 1 && /[:：]\s*$/.test(kept[kept.length - 1])) kept.pop();
  const rest = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!rest) return { text, items: [] };
  return { text: rest, items };
}
