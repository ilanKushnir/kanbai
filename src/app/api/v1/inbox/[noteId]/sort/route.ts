import { handler, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { fulfillNoteSchema } from "@/lib/validation";
import { fulfillNote, getNoteForAgent } from "@/lib/services/notes";

export const dynamic = "force-dynamic";

/** Agent turns a queued note into a real ticket on the chosen board. */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "inbox:write");
    const { noteId } = await params;
    await getNoteForAgent(noteId, agent.id); // 404s if not in this agent's inbox
    const input = parse(fulfillNoteSchema, await readJson(req));
    await assertBoardAccess(input.boardId, agent.workspaceId);

    const ticket = await fulfillNote(noteId, input, { type: "agent", id: agent.id, name: agent.name });
    return created({ ticket, noteId });
  },
);
