import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { updateNoteSchema } from "@/lib/validation";
import { updateNote, deleteNote } from "@/lib/services/notes";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";

async function assertOwn(noteId: string, userId: string) {
  const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
  if (!note || note.userId !== userId) throw new HttpError(404, "Note not found");
}

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const { user } = await getCurrentContext();
    const { noteId } = await params;
    await assertOwn(noteId, user!.id);
    const input = parse(updateNoteSchema, await readJson(req));
    const note = await updateNote(noteId, input);
    return ok({ note });
  },
);

export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const { user } = await getCurrentContext();
    const { noteId } = await params;
    await assertOwn(noteId, user!.id);
    await deleteNote(noteId);
    return ok({ ok: true });
  },
);
