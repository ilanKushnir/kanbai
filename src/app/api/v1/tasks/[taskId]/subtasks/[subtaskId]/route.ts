import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentNoteScope } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateTaskSubtaskSchema } from "@/lib/validation";
import { deleteNoteSubtask, getWorkspaceNote, updateNoteSubtask } from "@/lib/services/notes";
import { toSimpleTask } from "@/lib/services/simple-tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taskId: string; subtaskId: string }> };

/** PATCH { title?, completed? } → { subtask, task }. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const { taskId, subtaskId } = await params;
  await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  const input = parse(updateTaskSubtaskSchema, await readJson(req));
  const { subtask, note } = await updateNoteSubtask(taskId, subtaskId, input, { type: "agent", id: agent.id, name: agent.name });
  return ok({ subtask, task: toSimpleTask(note) });
});

export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const { taskId, subtaskId } = await params;
  await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  const { note } = await deleteNoteSubtask(taskId, subtaskId, { type: "agent", id: agent.id, name: agent.name });
  return ok({ ok: true, task: toSimpleTask(note) });
});
