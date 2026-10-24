import { db } from "@/lib/db";
import type { Actor } from "./tickets";

/** One "you were assigned" entry as the bell and the pop-up show it. */
export type SerializedNotification = {
  id: string;
  kind: "assigned";
  ticketId: string;
  ticketTitle: string;
  ticketNumber: number | null;
  boardName: string;
  boardSlug: string;
  workspaceId: string;
  workspaceName: string;
  actorType: "user" | "agent";
  actorName: string;
  createdAt: string;
  read: boolean;
};

/** How many entries the bell keeps around (read ones included). */
const RECENT_LIMIT = 30;

/**
 * Who gets told about being put on a ticket: everyone newly added, except the
 * person who did it — and except the owner of the agent that did it, since
 * their own agent filing work for them isn't news from outside.
 */
export async function assignmentRecipients(added: string[], actor: Actor): Promise<string[]> {
  if (!added.length || actor.type === "system") return [];
  let skip: string | null = null;
  if (actor.type === "user") skip = actor.id ?? null;
  else if (actor.id) {
    const agent = await db.agent.findUnique({ where: { id: actor.id }, select: { ownerUserId: true } });
    skip = agent?.ownerUserId ?? null;
  }
  return [...new Set(added)].filter((id) => id !== skip);
}

/**
 * Record "you were assigned" for the newly added people. Never throws: a
 * notification that fails to save must not fail the ticket write behind it.
 */
export async function notifyAssigned(input: {
  ticketId: string;
  workspaceId: string;
  added: string[];
  actor: Actor;
}): Promise<void> {
  try {
    const recipients = await assignmentRecipients(input.added, input.actor);
    if (!recipients.length) return;
    // Re-assigning someone who hasn't seen the first one yet: keep a single entry.
    await db.notification.deleteMany({
      where: { ticketId: input.ticketId, userId: { in: recipients }, readAt: null },
    });
    await db.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        workspaceId: input.workspaceId,
        kind: "assigned",
        ticketId: input.ticketId,
        actorType: input.actor.type === "agent" ? "agent" : "user",
        actorName: input.actor.name,
      })),
    });
  } catch (e) {
    console.error("notifyAssigned failed", e);
  }
}

/**
 * Taken off a ticket before seeing the news: the unread entry goes away, so
 * the pop-up never points at work that isn't yours any more.
 */
export async function withdrawAssigned(ticketId: string, removed: string[]): Promise<void> {
  if (!removed.length) return;
  try {
    await db.notification.deleteMany({ where: { ticketId, userId: { in: removed }, readAt: null } });
  } catch (e) {
    console.error("withdrawAssigned failed", e);
  }
}

/** The workspaces the viewer belongs to, and whether they manage each (managers see every board). */
export type NotificationScope = { workspaceId: string; isManager: boolean }[];

/**
 * The viewer's recent notifications across all their workspaces, newest
 * first — being put on a ticket on a board someone shared with you is news
 * wherever you happen to be. Tickets that were deleted or sit on a board the
 * viewer can no longer see drop out.
 */
export async function listNotifications(userId: string, scope: NotificationScope): Promise<SerializedNotification[]> {
  if (!scope.length) return [];
  const rows = await db.notification.findMany({
    where: {
      userId,
      ticket: {
        deletedAt: null,
        board: {
          archived: false,
          OR: scope.map((m) =>
            m.isManager ? { workspaceId: m.workspaceId } : { workspaceId: m.workspaceId, access: { some: { userId } } },
          ),
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    include: {
      ticket: {
        select: {
          title: true,
          number: true,
          board: { select: { name: true, slug: true, workspace: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return rows.map((n) => ({
    id: n.id,
    kind: "assigned",
    ticketId: n.ticketId,
    ticketTitle: n.ticket.title,
    ticketNumber: n.ticket.number,
    boardName: n.ticket.board.name,
    boardSlug: n.ticket.board.slug,
    workspaceId: n.ticket.board.workspace.id,
    workspaceName: n.ticket.board.workspace.name,
    actorType: n.actorType === "agent" ? "agent" : "user",
    actorName: n.actorName,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt != null,
  }));
}

/** Mark the given notifications (or all of them, when `ids` is omitted) as seen. */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const res = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.count;
}

/** Opening a ticket counts as seeing that you were put on it. */
export async function markTicketNotificationsRead(userId: string, ticketId: string): Promise<void> {
  await db.notification.updateMany({ where: { userId, ticketId, readAt: null }, data: { readAt: new Date() } });
}

/** The scope {@link listNotifications} needs, from a request context. */
export function notificationScope(ctx: { user: { id: string }; memberships: { workspace: { id: string }; role: string }[] }): NotificationScope {
  return ctx.memberships.map((m) => ({ workspaceId: m.workspace.id, isManager: m.role === "owner" || m.role === "admin" }));
}
