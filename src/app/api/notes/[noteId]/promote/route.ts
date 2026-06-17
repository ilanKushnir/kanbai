import { handler, created, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { promoteNoteSchema } from "@/lib/validation";
import { fulfillNote } from "@/lib/services/notes";
import { LABEL_COLORS } from "@/lib/constants";
import { db } from "@/lib/db";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Turn a captured note into a ticket as the user, resolving label names. */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const ctx = await getCurrentContext();
    const { noteId } = await params;

    const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    if (!note || note.userId !== ctx.user.id) throw new HttpError(404, "Note not found");

    const input = parse(promoteNoteSchema, await readJson(req));
    await assertBoardAccess(ctx, input.boardId, true);

    const labelIds: string[] = [];
    if (input.labelNames?.length) {
      const existing = await db.label.findMany({ where: { boardId: input.boardId } });
      for (const raw of input.labelNames) {
        const name = raw.trim();
        if (!name) continue;
        const match = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
        if (match) {
          labelIds.push(match.id);
          continue;
        }
        const color = LABEL_COLORS[hash(name) % LABEL_COLORS.length];
        const createdLabel = await db.label.create({ data: { boardId: input.boardId, name, color } });
        existing.push(createdLabel);
        labelIds.push(createdLabel.id);
      }
    }

    const ticket = await fulfillNote(
      noteId,
      {
        boardId: input.boardId,
        columnId: input.columnId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        labelIds,
      },
      { type: "user", id: ctx.user.id, name: ctx.user.name },
    );
    return created({ ticket });
  },
);
