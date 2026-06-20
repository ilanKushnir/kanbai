import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { queueNoteV1Schema } from "@/lib/validation";
import { getWorkspaceNote, queueNoteToAgent } from "@/lib/services/notes";

export const dynamic = "force-dynamic";

/** Queue a note to an agent to sort (defaults to the calling agent). */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    const { noteId } = await params;
    await getWorkspaceNote(noteId, agent.workspaceId); // 404s outside the workspace
    const { agentId, sortContext } = parse(queueNoteV1Schema, await readJson(req));

    const target = agentId ?? agent.id;
    if (target !== agent.id) await assertAgentInWorkspace(target, agent.workspaceId);

    const note = await queueNoteToAgent(noteId, target, sortContext, {
      type: "agent",
      id: agent.id,
      name: agent.name,
    });
    return ok({ note });
  },
);
