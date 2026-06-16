import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { sortNoteSchema } from "@/lib/validation";
import { queueNoteToAgent } from "@/lib/services/notes";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const { workspace, user } = await getCurrentContext();
    const { noteId } = await params;
    const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    if (!note || note.userId !== user!.id) throw new HttpError(404, "Note not found");

    const { agentId, sortContext } = parse(sortNoteSchema, await readJson(req));
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
    if (!agent || agent.workspaceId !== workspace.id) throw new HttpError(404, "Agent not found");

    const updated = await queueNoteToAgent(noteId, agentId, sortContext, {
      type: "user",
      id: user?.id,
      name: user?.name ?? "You",
    });
    return ok({ note: updated });
  },
);
