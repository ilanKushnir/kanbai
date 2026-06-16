import { z } from "zod";
import { PRIORITIES, AGENT_KINDS, ALL_SCOPES, BOARD_COLORS } from "./constants";

export const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  color: z.enum(BOARD_COLORS).optional(),
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
