import { handler, created, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { promoteNoteSchema } from "@/lib/validation";
import { fulfillNote } from "@/lib/services/notes";
import { db } from "@/lib/db";

/** Turn a captured note into a ticket as the user, resolving label names (created on the board when missing). */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const ctx = await getCurrentContext();
    const { noteId } = await params;

    const note = await db.note.findUnique({ where: { id: noteId }, select: { userId: true } });
    if (!note || note.userId !== ctx.user.id) throw new HttpError(404, "Note not found");

    const input = parse(promoteNoteSchema, await readJson(req));
    await assertBoardAccess(ctx, input.boardId, true);

    const ticket = await fulfillNote(
      noteId,
      {
        boardId: input.boardId,
        columnId: input.columnId,
        column: input.column,
        columnName: input.columnName,
        stage: input.stage,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        labelNames: input.labelNames,
      },
      { type: "user", id: ctx.user.id, name: ctx.user.name },
    );
    return created({ ticket });
  },
);
