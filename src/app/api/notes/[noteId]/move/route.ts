import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { moveNoteSchema } from "@/lib/validation";
import { moveNote } from "@/lib/services/notes";
import { db } from "@/lib/db";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const { user } = await getCurrentContext();
    const { noteId } = await params;
    const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    if (!note || note.userId !== user!.id) throw new HttpError(404, "Note not found");

    const { scheduledDay, position } = parse(moveNoteSchema, await readJson(req));
    const updated = await moveNote(noteId, user!.id, scheduledDay, position);
    return ok({ note: updated });
  },
);
