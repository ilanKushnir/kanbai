import { z } from "zod";
import { PRIORITIES, AGENT_KINDS, ALL_SCOPES, BOARD_COLORS, NOTE_BUCKETS } from "./constants";
import { COLUMN_STAGES } from "./column-stage";
import { isAvatarColor } from "./avatar-colors";

/**
 * A due date in ISO 8601, accepted in any of three unambiguous shapes:
 *   • date-only      "2026-06-20"            (interpreted as UTC midnight)
 *   • UTC instant    "2026-06-20T17:00:00Z"
 *   • zoned instant  "2026-06-20T17:00:00+02:00"
 * All normalize to a stable `Date` server-side via `new Date(value)`. A bare
 * local datetime with no zone ("2026-06-20T17:00:00") is rejected as ambiguous.
 * Keep this in sync with docs/AGENT_PROTOCOL.md (§ dueDate).
 */
export const dueDateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const signupSchema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(60),
  password: z.string().min(8).max(200),
  inviteToken: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

/** Workspace invite: targets an EXISTING account, so the email is required. */
export const createWorkspaceInviteSchema = z.object({
  email: z.email().max(200),
  role: z.enum(["admin", "member"]).optional(),
  boardAccess: z
    .array(z.object({ boardId: z.string(), level: z.enum(["view", "edit"]) }))
    .optional(),
});

/** System-level account invite (system admin only); email optionally locks it. */
export const createSystemInviteSchema = z.object({
  email: z.email().max(200).optional().or(z.literal("")),
});

export const updateMemberSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  boardAccess: z.array(z.object({ boardId: z.string(), level: z.enum(["view", "edit"]) })).optional(),
});

export const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  color: z.enum(BOARD_COLORS).optional(),
});

export const updateBoardSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  color: z.enum(BOARD_COLORS).optional(),
  isPublic: z.boolean().optional(),
  archived: z.boolean().optional(),
});

// ── Migration (agent API) ──
export const createBoardV1Schema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional(),
  color: z.enum(BOARD_COLORS).optional(),
  columns: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        isDone: z.boolean().optional(),
        stage: z.enum(COLUMN_STAGES).optional(),
      }),
    )
    .max(20)
    .optional(),
  labels: z.array(z.object({ name: z.string().trim().min(1).max(40), color: z.string().optional() })).max(40).optional(),
  createdAt: z.iso.datetime().optional(),
});

/** Agent API board update: metadata + archive (reversible; boards are never hard-deleted). */
export const updateBoardV1Schema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    color: z.enum(BOARD_COLORS).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update (name, description, color, archived).",
  });

export const createTicketV1Schema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().optional(),
  columnName: z.string().max(40).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.nullable().optional(),
  assigneeAgentId: z.string().optional(),
  // Human assignee, by id (preferred) or workspace email (migration). Must be
  // an assignable board member — validated in the route/service, not here.
  assigneeUserId: z.string().min(1).optional(),
  assigneeEmail: z.email().optional(),
  labelIds: z.array(z.string()).optional(),
  labelNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  number: z.number().int().min(0).optional(),
  createdAt: z.iso.datetime().optional(),
});

export const createMemberV1Schema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["admin", "member"]).optional(),
  boardAccess: z.array(z.object({ boardId: z.string(), level: z.enum(["view", "edit"]) })).optional(),
});

export const createTicketSchema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.nullable().optional(),
  assigneeType: z.enum(["user", "agent"]).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeAgentId: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const updateTicketSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.nullable().optional(),
  assigneeType: z.enum(["user", "agent"]).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeAgentId: z.string().nullable().optional(),
  columnId: z.string().optional(),
  position: z.number().optional(),
  subState: z.string().max(24).nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const moveTicketSchema = z.object({
  columnId: z.string().min(1),
  position: z.number().int().min(0),
  subState: z.string().max(24).nullable().optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

// ── Subtasks ──
export const createSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const updateSubtaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    completed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update (title, completed).",
  });

export const reorderSubtasksSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

/** Board share management: set a member's access to one board (null revokes). */
export const setBoardMemberAccessSchema = z.object({
  level: z.enum(["view", "edit"]).nullable(),
});

/** Pin/unpin a board for the signed-in user (a personal bookmark, not board state). */
export const pinBoardSchema = z.object({
  pinned: z.boolean(),
});

export const updateColumnSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  wipLimit: z.number().int().min(1).max(99).nullable().optional(),
  isDone: z.boolean().optional(),
  stage: z.enum(COLUMN_STAGES).optional(),
  subStates: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
});

/**
 * Agent API column update (PATCH /boards/{boardId}/columns/{columnId}).
 * Same editable surface as the UI, but a PATCH must change at least one field —
 * an empty body is rejected so an agent can't issue a silent no-op write.
 */
export const updateBoardColumnV1Schema = updateColumnSchema.refine(
  (v) => Object.keys(v).length > 0,
  { message: "Provide at least one field to update (name, subStates, isDone, stage, wipLimit)." },
);

export const createColumnSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  isDone: z.boolean().optional(),
  stage: z.enum(COLUMN_STAGES).optional(),
});

/** Agent API column create (boardId comes from the route path). */
export const createColumnV1Schema = createColumnSchema.omit({ boardId: true });

/** Agent API column reorder (boardId comes from the route path). */
export const reorderColumnsV1Schema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export const reorderColumnsSchema = z.object({
  boardId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

/** Local calendar day "YYYY-MM-DD" (timezone-proof note scheduling). */
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  scheduledDay: dayString.nullable().optional(),
  bucket: z.enum(NOTE_BUCKETS).optional(), // legacy fallback if scheduledDay omitted
  priority: z.enum(PRIORITIES).optional(),
});

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1).max(10_000).optional(),
  pinned: z.boolean().optional(),
  status: z.enum(["inbox", "archived"]).optional(),
  scheduledDay: dayString.nullable().optional(),
  doneOn: dayString.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export const moveNoteSchema = z.object({
  scheduledDay: dayString.nullable(),
  position: z.number().int().min(0),
});

// ── Notes (agent API) ──
/** Agent creates a note on behalf of a workspace user (defaults to the owner). */
export const createNoteV1Schema = z.object({
  body: z.string().trim().min(1).max(10_000),
  bucket: z.enum(NOTE_BUCKETS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  userId: z.string().min(1).optional(),
  userEmail: z.email().max(200).optional(),
});

/** Agent queues a note to an agent to sort (defaults to itself). */
export const queueNoteV1Schema = z.object({
  agentId: z.string().min(1).optional(),
  sortContext: z.string().max(4000).optional(),
});

export const ingestNoteSchema = z.object({
  ingest: z.boolean(),
  agentId: z.string().min(1).nullable().optional(),
});

export const attachmentSchema = z.object({
  kind: z.enum(["audio", "image", "file"]).optional(),
  mimeType: z.string().min(1).max(120),
  dataUrl: z.string().min(1).max(12_000_000), // ~9MB of base64; swap for object storage in prod
  filename: z.string().max(200).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const sortNoteSchema = z.object({
  agentId: z.string().min(1),
  sortContext: z.string().max(4000).optional(),
});

/** Agent uses this to turn a queued note into a real ticket. */
export const fulfillNoteSchema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

/** User files a note into a ticket themselves (no agent), with label names resolved/created. */
export const promoteNoteSchema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.nullable().optional(),
  labelNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

/**
 * Agent promotes ANY workspace note into a ticket in one action (create ticket +
 * mark the note sorted, atomically). `title` is optional — it defaults to the
 * note's first line — and labels resolve by id or by name (auto-created).
 */
export const promoteNoteV1Schema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().optional(),
  columnName: z.string().max(40).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.nullable().optional(),
  labelIds: z.array(z.string()).optional(),
  labelNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

/** Agent API member update: role and/or per-board access grants. */
export const updateMemberV1Schema = z
  .object({
    role: z.enum(["admin", "member"]).optional(),
    boardAccess: z.array(z.object({ boardId: z.string(), level: z.enum(["view", "edit"]) })).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update (role, boardAccess).",
  });

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(AGENT_KINDS),
  color: z.string().optional(),
});

/**
 * Agent self-setup: an authenticated agent registers/updates its OWN webhook
 * via its bearer key (POST /api/v1/agent/webhook). URL is required to register;
 * `active` toggles delivery; `secret` is optional (signing is recommended, not
 * required) — omit it to keep the current secret, send "" or null to clear it.
 */
export const registerWebhookV1Schema = z.object({
  url: z.url().max(2000).nullable().optional().or(z.literal("")),
  active: z.boolean().optional(),
  secret: z.string().min(8).max(200).nullable().optional().or(z.literal("")),
});

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  ownerUserId: z.string().max(60).nullable().optional().or(z.literal("")),
  webhookUrl: z.url().nullable().optional().or(z.literal("")),
  webhookSecret: z.string().max(200).nullable().optional(),
  webhookActive: z.boolean().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  scopes: z.array(z.enum(ALL_SCOPES)).optional(),
});

export const LANDING_PAGES = ["my-day", "notes", "boards"] as const;
export const DICTATION_LANGUAGE_VALUES = ["auto", "en", "he", "es", "fr", "de", "it", "pt", "ar", "ru", "zh", "ja", "ko"] as const;

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  email: z.email().max(200).optional(),
  avatarUrl: z.url().max(2000).nullable().optional().or(z.literal("")),
  avatarColor: z
    .string()
    .refine(isAvatarColor, "Pick a color from the avatar palette.")
    .nullable()
    .optional()
    .or(z.literal("")),
  defaultLanding: z.enum(LANDING_PAGES).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  handedness: z.enum(["right", "left"]).optional(),
  dictationLanguage: z.enum(DICTATION_LANGUAGE_VALUES).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const trashActionSchema = z.object({
  action: z.enum(["restore", "purge"]),
  type: z.enum(["note", "ticket"]),
  id: z.string().min(1),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  defaultAgentId: z.string().max(60).nullable().optional().or(z.literal("")),
  snapshotLimit: z.number().int().min(1).max(200).optional(),
});

export function formatZodError(err: z.ZodError) {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}
