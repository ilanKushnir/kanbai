import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentNoteScope } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateTaskV1Schema } from "@/lib/validation";
import { getWorkspaceNote, serializeNote, updateNote, deleteNote, notesToday } from "@/lib/services/notes";
import { resolveTaskDay, toSimpleTask } from "@/lib/services/simple-tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string }> };

export const GET = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:read");
  const { taskId } = await params;
  const note = await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  return ok({ task: toSimpleTask(serializeNote(note)) });
});

/** PATCH { title?, day?, done?, priority?, completeSubtasks? } — rename, reschedule, complete/reopen. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const { taskId } = await params;
  await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent)); // 404s outside the workspace
  const input = parse(updateTaskV1Schema, await readJson(req));
  const note = await updateNote(
    taskId,
    {
      body: input.title ?? input.body,
      scheduledDay: input.day === undefined ? undefined : resolveTaskDay(input.day),
      doneOn: input.done === undefined ? undefined : input.done ? notesToday() : null,
      priority: input.priority,
      completeSubtasks: input.done ? input.completeSubtasks ?? true : undefined,
    },
    { type: "agent", id: agent.id, name: agent.name },
  );
  return ok({ task: toSimpleTask(note) });
});

/** Soft-delete into the 30-day trash. */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const { taskId } = await params;
  await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  await deleteNote(taskId, { type: "agent", id: agent.id, name: agent.name });
  return ok({ ok: true });
});
