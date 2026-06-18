import { Prisma } from "@/generated/prisma";

export const ticketInclude = {
  labels: { include: { label: true } },
  agent: true,
  comments: { orderBy: { createdAt: "asc" as const } },
  column: { select: { id: true, name: true, isDone: true } },
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export type UserLite = { id: string; name: string; avatarUrl?: string | null };

export function serializeTicket(t: TicketWithRelations, usersById?: Map<string, UserLite>) {
  let assignee: null | {
    type: "user" | "agent";
    id: string;
    name: string;
    color?: string;
    kind?: string;
  } = null;

  if (t.assigneeType === "agent" && t.agent) {
    assignee = { type: "agent", id: t.agent.id, name: t.agent.name, color: t.agent.color, kind: t.agent.kind };
  } else if (t.assigneeType === "user" && t.assigneeUserId) {
    const u = usersById?.get(t.assigneeUserId);
    assignee = { type: "user", id: t.assigneeUserId, name: u?.name ?? "Someone" };
  }

  return {
    id: t.id,
    number: t.number,
    boardId: t.boardId,
    columnId: t.columnId,
    column: t.column?.name,
    title: t.title,
    description: t.description,
    position: t.position,
    priority: t.priority,
    dueDate: t.dueDate?.toISOString() ?? null,
    assignee,
    createdBy: { type: t.createdByType, id: t.createdById },
    labels: t.labels.map((tl) => ({ id: tl.label.id, name: tl.label.name, color: tl.label.color })),
    commentCount: t.comments.length,
    comments: t.comments.map((c) => ({
      id: c.id,
      authorType: c.authorType,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    sourceNoteId: t.sourceNoteId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export type SerializedTicket = ReturnType<typeof serializeTicket>;

export function serializeAgentPublic(a: {
  id: string;
  name: string;
  kind: string;
  color: string;
  status: string;
}) {
  return { id: a.id, name: a.name, kind: a.kind, color: a.color, status: a.status };
}
