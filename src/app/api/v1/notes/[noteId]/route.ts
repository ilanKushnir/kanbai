import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { updateNoteSchema } from "@/lib/validation";
import {
  getWorkspaceNote,
  serializeNote,
  updateNote,
  deleteNote,
} from "@/lib/services/notes";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:read");
    const { noteId } = await params;
    const note = await getWorkspaceNote(noteId, agent.workspaceId);
    return ok({ note: serializeNote(note) });
  },
);

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    const { noteId } = await params;
    await getWorkspaceNote(noteId, agent.workspaceId); // 404s outside the workspace
    const input = parse(updateNoteSchema, await readJson(req));
    const note = await updateNote(noteId, input);
    return ok({ note });
  },
);

export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    const { noteId } = await params;
    await getWorkspaceNote(noteId, agent.workspaceId); // 404s outside the workspace
    await deleteNote(noteId);
    return ok({ ok: true });
  },
);
