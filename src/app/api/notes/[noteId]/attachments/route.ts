import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { attachmentSchema } from "@/lib/validation";
import { addAttachment } from "@/lib/services/notes";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const { user } = await getCurrentContext();
    const { noteId } = await params;
    const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    if (!note || note.userId !== user!.id) throw new HttpError(404, "Note not found");

    const input = parse(attachmentSchema, await readJson(req));
    const updated = await addAttachment(noteId, input);
    return created({ note: updated });
  },
);
