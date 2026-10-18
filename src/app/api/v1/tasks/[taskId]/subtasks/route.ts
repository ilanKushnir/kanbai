import { handler, ok, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentNoteScope } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createSubtaskSchema } from "@/lib/validation";
import { addNoteSubtasks, getWorkspaceNote, serializeNote } from "@/lib/services/notes";
import { toSimpleTask } from "@/lib/services/simple-tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string }> };

/** GET — the task's checklist, in order. */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:read");
  const { taskId } = await params;
  const note = await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  return ok({ subtasks: serializeNote(note).subtasks });
});

/** POST { title } or { titles: [...] } — append subtasks → { subtasks (the new ones), task }. */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const { taskId } = await params;
  await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  const { title, titles } = parse(createSubtaskSchema, await readJson(req));
  const { subtasks, note } = await addNoteSubtasks(taskId, titles ?? [title!], { type: "agent", id: agent.id, name: agent.name });
  return created({ subtasks, task: toSimpleTask(note) });
});
