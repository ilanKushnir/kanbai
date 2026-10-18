import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentNoteScope } from "@/lib/access";
import { getWorkspaceNote, updateNote, notesToday } from "@/lib/services/notes";
import { toSimpleTask } from "@/lib/services/simple-tasks";
import { parse } from "@/lib/parse";
import { doneV1Schema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Complete a simple task today — the twin of POST /tickets/{id}/done. Ticks its subtasks too unless `{ completeSubtasks: false }`. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ taskId: string }> }) => {
  const agent = await requireAgent(req);
  requireScope(agent, "notes:write");
  const { taskId } = await params;
  await getWorkspaceNote(taskId, agent.workspaceId, await agentNoteScope(agent));
  const body = parse(doneV1Schema, await req.json().catch(() => undefined));
  const note = await updateNote(
    taskId,
    { doneOn: notesToday(), completeSubtasks: body?.completeSubtasks ?? true },
    { type: "agent", id: agent.id, name: agent.name },
  );
  return ok({ task: toSimpleTask(note) });
});
