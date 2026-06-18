import { z } from "zod";
import { PRIORITIES, AGENT_KINDS, ALL_SCOPES, BOARD_COLORS } from "./constants";

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

export const createInviteSchema = z.object({
  kind: z.enum(["workspace", "account"]),
  email: z.email().max(200).optional().or(z.literal("")),
  role: z.enum(["admin", "member"]).optional(),
  boardAccess: z
    .array(z.object({ boardId: z.string(), level: z.enum(["view", "edit"]) }))
    .optional(),
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
});

// ── Migration (agent API) ──
export const createBoardV1Schema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional(),
  color: z.enum(BOARD_COLORS).optional(),
  columns: z.array(z.object({ name: z.string().trim().min(1).max(40), isDone: z.boolean().optional() })).max(20).optional(),
  labels: z.array(z.object({ name: z.string().trim().min(1).max(40), color: z.string().optional() })).max(40).optional(),
  createdAt: z.iso.datetime().optional(),
});

export const createTicketV1Schema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().optional(),
  columnName: z.string().max(40).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  assigneeAgentId: z.string().optional(),
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
  dueDate: z.iso.datetime().nullable().optional(),
  assigneeType: z.enum(["user", "agent"]).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeAgentId: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const updateTicketSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  assigneeType: z.enum(["user", "agent"]).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeAgentId: z.string().nullable().optional(),
  columnId: z.string().optional(),
  position: z.number().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const moveTicketSchema = z.object({
  columnId: z.string().min(1),
  position: z.number().int().min(0),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export const updateColumnSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  wipLimit: z.number().int().min(1).max(99).nullable().optional(),
  isDone: z.boolean().optional(),
});

export const createColumnSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  isDone: z.boolean().optional(),
});

export const reorderColumnsSchema = z.object({
  boardId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

export const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1).max(10_000).optional(),
  pinned: z.boolean().optional(),
  status: z.enum(["inbox", "archived"]).optional(),
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
  dueDate: z.iso.datetime().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

/** User files a note into a ticket themselves (no agent), with label names resolved/created. */
export const promoteNoteSchema = z.object({
  boardId: z.string().min(1),
  columnId: z.string().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  labelNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(AGENT_KINDS),
  color: z.string().optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  webhookUrl: z.url().nullable().optional().or(z.literal("")),
  webhookSecret: z.string().max(200).nullable().optional(),
  webhookActive: z.boolean().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  scopes: z.array(z.enum(ALL_SCOPES)).optional(),
});

export function formatZodError(err: z.ZodError) {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}
