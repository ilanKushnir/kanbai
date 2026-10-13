import { Prisma } from "@/generated/prisma";
import { handler, ok, created, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentBoardWhere, assertAgentBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createTicketV1Schema, listTicketsQuerySchema } from "@/lib/validation";
import { createTicket } from "@/lib/services/tickets";
import { compareAgendaTickets, ticketListInclude, toAgendaTicket, workspaceUsersById } from "@/lib/services/agenda";
import { guardAgentSnapshot } from "@/lib/snapshots";
import { addDaysYmd, endOfDayInTz, startOfDayInTz, todayYmd, workspaceTz } from "@/lib/tz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tickets — cross-board ticket list.
 *   boardId   limit to one board
 *   status    open (default) | done | all
 *   due       overdue | today | tomorrow | week | none | any (default)
 *   assigned  me (the agent itself / its owner) | any (default) | unassigned | <userId>
 *   q         case-insensitive substring on the title
 *   limit     default 200
 * Each ticket carries `board` {id,name,slug,color,doneColumnId} and `column`
 * {id,name,isDone,stage}. Respects the agent's board access cap.
 */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "tickets:read");
  const url = new URL(req.url);
  const q = parse(listTicketsQuerySchema, Object.fromEntries(url.searchParams.entries()));

  if (q.boardId) await assertAgentBoardAccess(agent, q.boardId);
  const board: Prisma.BoardWhereInput = { ...(await agentBoardWhere(agent)), ...(q.boardId ? { id: q.boardId } : {}) };

  const where: Prisma.TicketWhereInput = { board, deletedAt: null };
  if (q.status === "open") where.column = { isDone: false };
  else if (q.status === "done") where.column = { isDone: true };

  const tz = workspaceTz();
  const today = todayYmd(tz);
  const startToday = startOfDayInTz(today, tz);
  const startTomorrow = endOfDayInTz(today, tz);
  switch (q.due) {
    case "overdue":
      where.dueDate = { lt: startToday };
      break;
    case "today":
      where.dueDate = { gte: startToday, lt: startTomorrow };
      break;
    case "tomorrow":
      where.dueDate = { gte: startTomorrow, lt: endOfDayInTz(addDaysYmd(today, 1), tz) };
      break;
    case "week":
      where.dueDate = { gte: startToday, lt: endOfDayInTz(addDaysYmd(today, 7), tz) };
      break;
    case "none":
      where.dueDate = null;
      break;
  }

  if (q.assigned === "me") {
    // "me" is the acting agent, or — for an owned agent — its owner as well.
    where.OR = [
      { assigneeType: "agent", assigneeAgentId: agent.id },
      ...(agent.ownerUserId
        ? [
            { assigneeType: "user", assigneeUserId: agent.ownerUserId },
            { assigneeType: "user", assignees: { some: { userId: agent.ownerUserId } } },
          ]
        : []),
    ];
  } else if (q.assigned === "unassigned") {
    where.OR = [{ assigneeType: null }, { assigneeType: "user", assigneeUserId: null, assignees: { none: {} } }];
  } else if (q.assigned !== "any") {
    where.OR = [
      { assigneeType: "user", assigneeUserId: q.assigned },
      { assigneeType: "user", assignees: { some: { userId: q.assigned } } },
      { assigneeType: "agent", assigneeAgentId: q.assigned },
    ];
  }
  // SQLite has no case-insensitive `contains`; filter titles in JS below.
  const needle = q.q?.toLowerCase();

  const rows = await db.ticket.findMany({
    where,
    include: ticketListInclude,
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    take: needle ? Math.max(q.limit * 5, 1000) : q.limit,
  });
  const usersById = await workspaceUsersById(agent.workspaceId);
  const tickets = rows
    .filter((t) => !needle || t.title.toLowerCase().includes(needle))
    .map((t) => toAgendaTicket(t, usersById))
    .sort(compareAgendaTickets)
    .slice(0, q.limit);
  return ok({ tickets, count: tickets.length });
});

export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "tickets:write");
  const input = parse(createTicketV1Schema, await readJson(req));
  await assertAgentBoardAccess(agent, input.boardId);
  // Snapshot before ANY write this session — including the label find-or-create
  // inside createTicket — so a restore can fully undo agent-created labels too.
  await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });

  // Assignee: agent, or a human by user id / workspace email (migration).
  // A human assignee must be an assignable board member — createTicket's
  // resolveAssignee rejects outsiders and members the board isn't shared with.
  let assigneeType: "user" | "agent" | null = null;
  let assigneeUserId: string | null = null;
  let assigneeAgentId: string | null = null;
  if (input.assigneeAgentId) {
    assigneeType = "agent";
    assigneeAgentId = input.assigneeAgentId;
  } else if (input.assigneeUserId) {
    assigneeType = "user";
    assigneeUserId = input.assigneeUserId;
  } else if (input.assigneeEmail) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: agent.workspaceId, user: { email: input.assigneeEmail.toLowerCase() } },
      select: { userId: true },
    });
    if (!member) {
      throw new HttpError(422, "assigneeEmail does not match any workspace member", "assignee_not_member");
    }
    assigneeType = "user";
    assigneeUserId = member.userId;
  }

  const ticket = await createTicket(
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
      labelIds: input.labelIds,
      labelNames: input.labelNames,
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
