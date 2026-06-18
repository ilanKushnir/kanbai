import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { ingestNoteSchema } from "@/lib/validation";
import { ingestNote } from "@/lib/services/notes";
import { db } from "@/lib/db";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const { workspace, user } = await getCurrentContext();
    const { noteId } = await params;
    const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    if (!note || note.userId !== user!.id) throw new HttpError(404, "Note not found");

    const { ingest, agentId: requested } = parse(ingestNoteSchema, await readJson(req));

    // Resolve which agent picks this up: the requested one (must be in this
    // workspace + active) or, by default, the workspace's primary active agent.
    let agentId: string | null = null;
    if (ingest) {
      if (requested) {
        const a = await db.agent.findUnique({
          where: { id: requested },
          select: { workspaceId: true, status: true },
        });
        if (!a || a.workspaceId !== workspace.id) throw new HttpError(404, "Agent not found");
        if (a.status === "active") agentId = requested;
      } else {
        // Prefer the workspace's configured default agent, else the oldest active one.
        const ws = await db.workspace.findUnique({
          where: { id: workspace.id },
          select: { defaultAgentId: true },
        });
        if (ws?.defaultAgentId) {
          const pref = await db.agent.findUnique({
            where: { id: ws.defaultAgentId },
            select: { id: true, status: true, workspaceId: true },
          });
          if (pref && pref.workspaceId === workspace.id && pref.status === "active") agentId = pref.id;
        }
        if (!agentId) {
          const fallback = await db.agent.findFirst({
            where: { workspaceId: workspace.id, status: "active" },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          agentId = fallback?.id ?? null;
        }
      }
    }

    const updated = await ingestNote(noteId, ingest, agentId, {
      type: "user",
      id: user?.id,
      name: user?.name ?? "You",
    });
    return ok({ note: updated });
  },
);
