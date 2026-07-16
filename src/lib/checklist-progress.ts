import { z } from "zod";

/**
 * The progress file produced by the offline checklist HTML export.
 *
 * v1 files carry only `items` (ticks against exported tickets/notes).
 * v2 files additionally carry `extras`: local-only tasks the user added inside
 * the checklist while offline (stored in the file's localStorage). On import,
 * extras become fresh notes — done ones arrive already completed — so a week
 * of offline task management round-trips back into Kanbai.
 *
 * Unknown top-level keys (kanbai, version, exportedAt, savedAt…) are ignored,
 * so both file versions parse with this one schema.
 */

/** Local calendar day "YYYY-MM-DD" (matches the checklist's own stamping). */
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const progressItemSchema = z.object({
  type: z.enum(["ticket", "note"]),
  id: z.string().min(1).max(64),
  done: z.boolean().optional(),
  doneAt: dayString.optional(),
});

export const progressExtraSchema = z.object({
  id: z.string().max(64).optional(),
  text: z.string().trim().min(1).max(10_000),
  done: z.boolean().optional(),
  doneAt: dayString.optional(),
  createdAt: dayString.optional(),
});

export const checklistProgressSchema = z
  .object({
    items: z.array(progressItemSchema).max(5000).optional().default([]),
    extras: z.array(progressExtraSchema).max(500).optional().default([]),
  })
  .refine((v) => v.items.length > 0 || v.extras.length > 0, {
    message: "The progress file has no checked items and no extra tasks.",
  });

export type ProgressItem = z.infer<typeof progressItemSchema>;
export type ProgressExtra = z.infer<typeof progressExtraSchema>;
export type ChecklistProgress = z.infer<typeof checklistProgressSchema>;
