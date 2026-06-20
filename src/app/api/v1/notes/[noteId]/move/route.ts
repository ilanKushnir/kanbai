import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { moveNoteSchema } from "@/lib/validation";
import { getWorkspaceNote, moveNote } from "@/lib/services/notes";

export const dynamic = "force-dynamic";

/** Move a note to a bucket/position within its owner's list. */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    const { noteId } = await params;
    const note = await getWorkspaceNote(noteId, agent.workspaceId);
    const { bucket, position } = parse(moveNoteSchema, await readJson(req));
    const updated = await moveNote(noteId, note.userId, bucket, position);
    return ok({ note: updated });
  },
);
