// Column stages — the semantic "type" of a board column, driving visual
// treatment and configuration. Stored on Column.stage (nullable); when unset,
// a sensible stage is derived from the column's name + isDone flag so existing
// boards pick up the right look without a data migration.
//
// Meaning of each stage:
//   intake  — "Ideas": future ideas / raw, ungroomed intake; not reviewed yet.
//   backlog — reviewed backlog; ready-ish, neutral.
//   active  — "In Work": the focus of the board.
//   done    — completed work; always paired with isDone = true.

export const COLUMN_STAGES = ["intake", "backlog", "active", "done"] as const;
export type ColumnStage = (typeof COLUMN_STAGES)[number];

export const STAGE_META: Record<ColumnStage, { label: string; hint: string }> = {
  intake: { label: "Ideas", hint: "Raw ideas & intake — not reviewed yet" },
  backlog: { label: "Backlog", hint: "Reviewed and ready to pick up" },
  active: { label: "In Work", hint: "Being worked on right now" },
  done: { label: "Done", hint: "Completed — cards here count as done" },
};

export function isColumnStage(v: unknown): v is ColumnStage {
  return typeof v === "string" && (COLUMN_STAGES as readonly string[]).includes(v);
}

const INTAKE_NAME = /\b(ideas?|inbox|intake|triage|incoming|someday|icebox|maybe|bg)\b/i;
const BACKLOG_NAME = /\b(backlog|to[- ]?do|todo|ready|next( up)?|queued?|planned|later|idle)\b/i;

/**
 * Derive a stage for a column that has none stored. `isDone` always wins
 * (done columns must keep counting completions); otherwise the name decides
 * between intake/backlog, defaulting to `active`.
 */
export function deriveColumnStage(name: string, isDone: boolean): ColumnStage {
  if (isDone) return "done";
  if (INTAKE_NAME.test(name)) return "intake";
  if (BACKLOG_NAME.test(name)) return "backlog";
  return "active";
}

/**
 * The effective stage of a column: the stored value when valid, else derived.
 * A stored non-done stage on a column flagged isDone still resolves to "done"
 * so the flag (which drives completion counting) can never disagree with the
 * visual language.
 */
export function resolveColumnStage(
  stage: string | null | undefined,
  name: string,
  isDone: boolean,
): ColumnStage {
  if (isDone) return "done";
  if (isColumnStage(stage) && stage !== "done") return stage;
  return deriveColumnStage(name, isDone);
}
