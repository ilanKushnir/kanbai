import { handler, created, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createTicketV1Schema } from "@/lib/validation";
import { createTicket } from "@/lib/services/tickets";
import { LABEL_COLORS } from "@/lib/constants";
import { db } from "@/lib/db";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "tickets:write");
  const input = parse(createTicketV1Schema, await readJson(req));
  await assertBoardInWorkspace(input.boardId, agent.workspaceId);

  // Resolve a column by name (migration) if no id given.
  let columnId = input.columnId;
  if (!columnId && input.columnName) {
    const cols = await db.column.findMany({ where: { boardId: input.boardId } });
    columnId = cols.find((c) => c.name.toLowerCase() === input.columnName!.toLowerCase())?.id;
    if (!columnId) {
      throw new HttpError(422, `No column named "${input.columnName}" on this board`);
    }
  }

  // Labels: explicit ids + find-or-create by name.
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

  // Assignee: agent, or a workspace member by email (migration).
  let assigneeType: "user" | "agent" | null = null;
  let assigneeUserId: string | null = null;
  let assigneeAgentId: string | null = null;
  if (input.assigneeAgentId) {
    assigneeType = "agent";
    assigneeAgentId = input.assigneeAgentId;
  } else if (input.assigneeEmail) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: agent.workspaceId, user: { email: input.assigneeEmail.toLowerCase() } },
      select: { userId: true },
    });
    if (member) {
      assigneeType = "user";
      assigneeUserId = member.userId;
    }
  }

  const ticket = await createTicket(
    {
      boardId: input.boardId,
      columnId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      labelIds,
      assigneeType,
      assigneeUserId,
      assigneeAgentId,
      number: input.number,
      createdAt: input.createdAt ?? null,
    },
    { type: "agent", id: agent.id, name: agent.name },
  );
  return created({ ticket });
});
