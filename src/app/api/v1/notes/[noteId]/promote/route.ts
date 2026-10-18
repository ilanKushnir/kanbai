import { handler, created, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentBoardAccess, agentNoteScope } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { promoteNoteV1Schema } from "@/lib/validation";
import { getWorkspaceNote, promoteNote } from "@/lib/services/notes";
import { htmlToPlainText } from "@/lib/utils";
import { guardAgentSnapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

/**
 * Promote ANY workspace note into a ticket in ONE action: creates the ticket
 * from the note and atomically marks the note "sorted" (linked to the ticket,
 * gone from Today, fully recoverable — nothing is deleted).
 *
 * `title` defaults to the note's first line; when the note has more content and
 * no `description` is given, the full note body carries over as the description.
 * Column by `columnId`, `column`/`columnName` or `stage`; labels by id or name.
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    requireScope(agent, "tickets:write");
    const { noteId } = await params;

    const note = await getWorkspaceNote(noteId, agent.workspaceId, await agentNoteScope(agent));
    if (note.deletedAt) throw new HttpError(404, "Note not found");
    if (note.ticket) throw new HttpError(409, "Note already sorted into a ticket");

    const input = parse(promoteNoteV1Schema, await readJson(req));
    await assertAgentBoardAccess(agent, input.boardId);
    // Snapshot before ANY write this session — label creation included — so a
    // restore can fully undo the promotion.
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });

    // Sensible defaults straight from the note.
    const plain = htmlToPlainText(note.body);
    const firstLine = htmlToPlainText(note.body.split("\n")[0] ?? "");
    const title = input.title ?? (firstLine || plain).slice(0, 200).trim();
    if (!title) throw new HttpError(422, "Note is empty — provide a title.");
    const description =
      input.description ?? (note.body.trim() !== firstLine.trim() ? note.body : undefined);

    const ticket = await promoteNote(
      noteId,
      {
        boardId: input.boardId,
        columnId: input.columnId,
        column: input.column,
        columnName: input.columnName,
        stage: input.stage,
        title,
        description,
        priority: input.priority ?? (note.priority !== "none" ? note.priority : undefined),
        dueDate: input.dueDate,
        labelIds: input.labelIds,
        labelNames: input.labelNames,
      },
      { type: "agent", id: agent.id, name: agent.name },
    );
    return created({ ticket, note: { id: noteId, status: "sorted" } });
  },
);
