import { handler, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { attachmentSchema } from "@/lib/validation";
import { getWorkspaceNote, addAttachment } from "@/lib/services/notes";

export const dynamic = "force-dynamic";

/** Attach a file/audio/image (base64 data URL) to a note. */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    const { noteId } = await params;
    await getWorkspaceNote(noteId, agent.workspaceId); // 404s outside the workspace
    const input = parse(attachmentSchema, await readJson(req));
    const note = await addAttachment(noteId, input);
    return created({ note });
  },
);
