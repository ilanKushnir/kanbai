import { Prisma } from "@/generated/prisma";
import { toRichHtml } from "@/lib/sanitize";
import { secretFingerprint } from "@/lib/crypto";

export const ticketInclude = {
  labels: { include: { label: true } },
  // The owning user rides along so agent assignees render with owner context
  // ("Hermes · Yuval") everywhere without a members lookup.
  agent: { include: { ownerUser: { select: { id: true, name: true } } } },
  // All human assignees (multi-assign), in display order, with the user data
  // the card avatar needs riding along.
  assignees: {
    orderBy: { position: "asc" as const },
    include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
  },
  comments: { orderBy: { createdAt: "asc" as const } },
  subtasks: { orderBy: { position: "asc" as const } },
  column: { select: { id: true, name: true, isDone: true } },
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export type UserLite = { id: string; name: string; avatarUrl?: string | null; avatarColor?: string | null };

export type SerializedAssignee = {
  type: "user" | "agent";
  id: string;
  name: string;
  /** Agent color, or a user's chosen initials-avatar color. */
  color?: string;
  kind?: string;
  /** User assignees only: profile image for the card avatar. */
  avatarUrl?: string | null;
  /** Agent assignees only: the owning user (null = workspace agent). */
  ownerUserId?: string | null;
  ownerName?: string | null;
};

export function serializeTicket(t: TicketWithRelations, usersById?: Map<string, UserLite>) {
  // `assignees` is the full list (agent = a single entry); `assignee` stays the
  // primary (first) one so single-assignee clients keep working unchanged.
  let assignees: SerializedAssignee[] = [];

  if (t.assigneeType === "agent" && t.agent) {
    assignees = [{
      type: "agent",
      id: t.agent.id,
      name: t.agent.name,
      color: t.agent.color,
      kind: t.agent.kind,
      ownerUserId: t.agent.ownerUserId,
      ownerName: t.agent.ownerUser?.name ?? null,
    }];
  } else if (t.assigneeType === "user") {
    assignees = t.assignees.map((a) => ({
      type: "user" as const,
      id: a.user.id,
      name: a.user.name,
      color: a.user.avatarColor ?? undefined,
      avatarUrl: a.user.avatarUrl ?? null,
    }));
    // Legacy row with no join entries: fall back to the single-assignee pair.
    if (!assignees.length && t.assigneeUserId) {
      const u = usersById?.get(t.assigneeUserId);
      assignees = [{
        type: "user",
        id: t.assigneeUserId,
        name: u?.name ?? "Someone",
        color: u?.avatarColor ?? undefined,
        avatarUrl: u?.avatarUrl ?? null,
      }];
    }
  }
  const assignee: SerializedAssignee | null = assignees[0] ?? null;

  return {
    id: t.id,
    number: t.number,
    boardId: t.boardId,
    columnId: t.columnId,
    column: t.column?.name,
    title: t.title,
    // Sanitize on read too — guards against any legacy/unsanitized rows reaching dangerouslySetInnerHTML.
    description: toRichHtml(t.description),
    position: t.position,
    priority: t.priority,
    subState: t.subState ?? null,
    dueDate: t.dueDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    /** Ticket sits in a done column — due chips render "Done", never "overdue". */
    isDone: t.column?.isDone ?? false,
    assignee,
    assignees,
    createdBy: { type: t.createdByType, id: t.createdById },
    labels: t.labels.map((tl) => ({ id: tl.label.id, name: tl.label.name, color: tl.label.color })),
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      completed: s.completed,
      position: s.position,
      createdAt: s.createdAt.toISOString(),
    })),
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

export type SerializedTicket = Omit<ReturnType<typeof serializeTicket>, "assignee"> & {
  assignee: SerializedAssignee | null;
};

/**
 * Minimal, safe ticket DTO for the PUBLIC (unauthenticated) board page. Strips
 * everything an anonymous visitor shouldn't see — comment threads & author names,
 * createdBy, and raw user/agent ids — keeping only what the read-only UI renders.
 */
export function serializePublicTicket(t: TicketWithRelations, usersById?: Map<string, UserLite>) {
  let assignees: { type: "user" | "agent"; name: string; color?: string }[] = [];
  if (t.assigneeType === "agent" && t.agent) {
    assignees = [{ type: "agent", name: t.agent.name, color: t.agent.color }];
  } else if (t.assigneeType === "user") {
    assignees = t.assignees.map((a) => ({ type: "user" as const, name: a.user.name }));
    if (!assignees.length && t.assigneeUserId) {
      assignees = [{ type: "user", name: usersById?.get(t.assigneeUserId)?.name ?? "Someone" }];
    }
  }
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: toRichHtml(t.description),
    column: t.column?.name,
    subState: t.subState ?? null,
    priority: t.priority,
    dueDate: t.dueDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    isDone: t.column?.isDone ?? false,
    assignee: assignees[0] ?? null,
    assignees,
    labels: t.labels.map((tl) => ({ id: tl.label.id, name: tl.label.name, color: tl.label.color })),
    commentCount: t.comments.length,
  };
}

export type SerializedPublicTicket = Omit<ReturnType<typeof serializePublicTicket>, "assignee"> & {
  assignee: { type: "user" | "agent"; name: string; color?: string } | null;
};

export function serializeAgentPublic(a: {
  id: string;
  name: string;
  kind: string;
  color: string;
  status: string;
}) {
  return { id: a.id, name: a.name, kind: a.kind, color: a.color, status: a.status };
}

/**
 * Webhook status for an agent, as reported to the agent itself (GET /api/v1/me,
 * the self-setup endpoint). Never leaks the signing secret — only whether one
 * is configured. `signed` reflects optional HMAC: callbacks still fire when
 * false, just unsigned.
 */
export function serializeWebhookStatus(a: {
  webhookUrl: string | null;
  webhookActive: boolean;
  webhookSecret: string | null;
  webhookEvents?: string;
}) {
  const configured = !!a.webhookUrl;
  const signed = !!a.webhookSecret;
  return {
    url: a.webhookUrl,
    active: a.webhookActive,
    configured,
    signed,
    // Short hash of the signing secret (never the secret). Compare with your
    // own sha256(secret).slice(0,8) to detect a mismatch — the usual 401 cause.
    secretFingerprint: a.webhookSecret ? secretFingerprint(a.webhookSecret) : null,
    // "*" = all events; otherwise a comma list. "ping" is always delivered.
    events: a.webhookEvents ?? "*",
    // Human-readable status mirroring the Agents UI labels.
    status: !configured ? "not_configured" : !a.webhookActive ? "disabled" : signed ? "signed" : "unsigned",
  };
}
