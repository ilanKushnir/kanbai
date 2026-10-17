import { handler, ok, created, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentNoteScope } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createTaskV1Schema } from "@/lib/validation";
import { createNote, listNotesForWorkspace, resolveWorkspaceUserId } from "@/lib/services/notes";
import { resolveTaskDay, toSimpleTask } from "@/lib/services/simple-tasks";

export const dynamic = "force-dynamic";

const DAY_FILTER = /^(all|today|tomorrow|someday|\d{4}-\d{2}-\d{2})$/;
const STATUS_FILTERS = ["open", "done", "all"];

/**
 * GET /api/v1/tasks?day=all|today|tomorrow|someday|YYYY-MM-DD&status=open|done|all
 *
 * The owner's simple tasks — Today's plain to-dos (not board tickets). Defaults:
 * every day, open only. Promoted/archived notes are not tasks any more.
 */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:read");
  const url = new URL(req.url);
  const day = url.searchParams.get("day") ?? "all";
  const status = url.searchParams.get("status") ?? "open";
  if (!DAY_FILTER.test(day)) throw new HttpError(422, "Invalid day. One of: all, today, tomorrow, someday, YYYY-MM-DD");
  if (!STATUS_FILTERS.includes(status)) throw new HttpError(422, `Invalid status. One of: ${STATUS_FILTERS.join(", ")}`);

  const userId = (await agentNoteScope(agent)) ?? (await resolveWorkspaceUserId(agent.workspaceId, {}));
  const wantDay = day === "all" ? undefined : resolveTaskDay(day);
  const tasks = (await listNotesForWorkspace(agent.workspaceId, { userId }))
    .filter((n) => n.status === "inbox" || n.status === "queued")
    .filter((n) => wantDay === undefined || n.scheduledDay === wantDay)
    .filter((n) => status === "all" || (status === "done") === (n.doneOn != null))
    .map(toSimpleTask)
    .sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999"));
  return ok({ tasks });
});

/** POST /api/v1/tasks { title, day?, priority? } — add a plain to-do (default: today). */
export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const input = parse(createTaskV1Schema, await readJson(req));
  const userId = (await agentNoteScope(agent)) ?? (await resolveWorkspaceUserId(agent.workspaceId, {}));
  const note = await createNote(
    userId,
    (input.title ?? input.body)!,
    { scheduledDay: resolveTaskDay(input.day), priority: input.priority },
    { type: "agent", id: agent.id, name: agent.name },
  );
  return created({ task: toSimpleTask(note) });
});
