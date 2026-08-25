import { handler, ok, created, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentNoteScope } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createNoteV1Schema } from "@/lib/validation";
import { NOTE_BUCKETS } from "@/lib/constants";
import {
  createNote,
  listNotesForWorkspace,
  resolveWorkspaceUserId,
} from "@/lib/services/notes";

export const dynamic = "force-dynamic";

const NOTE_STATUSES = ["inbox", "queued", "sorting", "sorted", "archived"];

/** List notes owned by members of the agent's workspace (no cross-workspace leak). */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:read");

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const bucket = url.searchParams.get("bucket") ?? undefined;
  // An owned, non-manager agent only ever sees its owner's notes; the userId
  // filter can narrow further but can't widen past that scope.
  const scope = await agentNoteScope(agent);
  const userId = scope ?? url.searchParams.get("userId") ?? undefined;
  // `assigned=me` narrows to notes queued to this agent.
  const assignedAgentId = url.searchParams.get("assigned") === "me" ? agent.id : undefined;

  if (status && !NOTE_STATUSES.includes(status)) {
    throw new HttpError(422, `Invalid status. One of: ${NOTE_STATUSES.join(", ")}`);
  }
  if (bucket && !NOTE_BUCKETS.includes(bucket as (typeof NOTE_BUCKETS)[number])) {
    throw new HttpError(422, `Invalid bucket. One of: ${NOTE_BUCKETS.join(", ")}`);
  }

  const notes = await listNotesForWorkspace(agent.workspaceId, {
    status,
    bucket,
    userId,
    assignedAgentId,
  });
  return ok({ notes });
});

/** Create a note on behalf of a workspace user (defaults to the workspace owner). */
export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const input = parse(createNoteV1Schema, await readJson(req));

  // An owned, non-manager agent can only create notes for its own owner; it
  // can't file notes into other members' inboxes.
  const scope = await agentNoteScope(agent);
  const userId = scope ?? (await resolveWorkspaceUserId(agent.workspaceId, {
    userId: input.userId,
    userEmail: input.userEmail,
  }));
  const note = await createNote(userId, input.body, {
    bucket: input.bucket,
    priority: input.priority,
  });
  return created({ note });
});
