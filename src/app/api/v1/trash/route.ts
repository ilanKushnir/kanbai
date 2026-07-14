import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import {
  listTrashForWorkspace,
  restoreNoteInWorkspace,
  restoreTicketInWorkspace,
  TRASH_DAYS,
} from "@/lib/services/trash";

export const dynamic = "force-dynamic";

/**
 * The workspace's trash, for agents. Soft-deleted notes and tickets sit here
 * for 30 days before being purged. Listing is filtered to what the agent's
 * scopes allow it to read; restore requires the matching write scope.
 * Permanent purge is deliberately NOT exposed to agents — humans only.
 */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  const scopes = agent.scopes.split(",").map((s) => s.trim());
  const canNotes = scopes.includes("notes:read");
  const canTickets = scopes.includes("tickets:read");
  if (!canNotes && !canTickets) requireScope(agent, "tickets:read"); // 403 with a clear message
  const trash = await listTrashForWorkspace(agent.workspaceId, { notes: canNotes, tickets: canTickets });
  return ok({ ...trash, retentionDays: TRASH_DAYS });
});

const restoreSchema = z.object({
  action: z.literal("restore"),
  type: z.enum(["note", "ticket"]),
  id: z.string().min(1).max(64),
});

export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  const { type, id } = parse(restoreSchema, await readJson(req));
  if (type === "note") {
    requireScope(agent, "notes:write");
    await restoreNoteInWorkspace(agent.workspaceId, id);
  } else {
    requireScope(agent, "tickets:write");
    await restoreTicketInWorkspace(agent.workspaceId, id);
  }
  return ok({ ok: true, restored: { type, id } });
});
