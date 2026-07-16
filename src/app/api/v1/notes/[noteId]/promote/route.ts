import { handler, created, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { promoteNoteV1Schema } from "@/lib/validation";
import { getWorkspaceNote, fulfillNote } from "@/lib/services/notes";
import { htmlToPlainText } from "@/lib/utils";
import { guardAgentSnapshot } from "@/lib/snapshots";
import { LABEL_COLORS } from "@/lib/constants";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Promote ANY workspace note into a ticket in ONE action: creates the ticket
 * from the note and atomically marks the note "sorted" (linked to the ticket,
 * hidden from the inbox, fully recoverable — nothing is deleted). Unlike
 * POST /inbox/{id}/sort, the note does not have to be queued to this agent.
 *
 * `title` defaults to the note's first line; when the note has more content and
 * no `description` is given, the full note body carries over as the description.
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ noteId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "notes:write");
    requireScope(agent, "tickets:write");
    const { noteId } = await params;

    const note = await getWorkspaceNote(noteId, agent.workspaceId);
    if (note.deletedAt) throw new HttpError(404, "Note not found");
    if (note.ticket) throw new HttpError(409, "Note already sorted into a ticket");

    const input = parse(promoteNoteV1Schema, await readJson(req));
    await assertBoardInWorkspace(input.boardId, agent.workspaceId);
    // Snapshot before ANY write this session — label creation included — so a
    // restore can fully undo the promotion.
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });

    // Resolve a column by name if no id was given.
    let columnId = input.columnId;
    if (!columnId && input.columnName) {
      const cols = await db.column.findMany({ where: { boardId: input.boardId } });
      columnId = cols.find((c) => c.name.toLowerCase() === input.columnName!.toLowerCase())?.id;
      if (!columnId) throw new HttpError(422, `No column named "${input.columnName}" on this board`);
    }

    // Resolve labels by id and/or by name (names are find-or-created).
    const labelIds = [...(input.labelIds ?? [])];
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

    // Sensible defaults straight from the note.
    const plain = htmlToPlainText(note.body);
    const firstLine = htmlToPlainText(note.body.split("\n")[0] ?? "");
    const title = input.title ?? (firstLine || plain).slice(0, 200).trim();
    if (!title) throw new HttpError(422, "Note is empty — provide a title.");
    const description =
      input.description ?? (note.body.trim() !== firstLine.trim() ? note.body : undefined);

    const ticket = await fulfillNote(
      noteId,
      {
        boardId: input.boardId,
        columnId,
        title,
        description,
        priority: input.priority ?? (note.priority !== "none" ? note.priority : undefined),
        dueDate: input.dueDate,
        labelIds: [...new Set(labelIds)],
      },
      { type: "agent", id: agent.id, name: agent.name },
    );
    return created({ ticket, note: { id: noteId, status: "sorted" } });
  },
);
