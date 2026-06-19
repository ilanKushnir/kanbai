import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { shortId } from "@/lib/password";
import type { Prisma } from "@/generated/prisma";
import type { Actor } from "@/lib/services/tickets";

/**
 * Board-state snapshots — a lightweight "undo" for agentic changes.
 *
 * Model: a snapshot is taken lazily, ONCE, before the first action of an agent
 * run (a "session"). It is NOT taken again until the next manual user action
 * resets the session. So a whole batch of agent edits is covered by a single
 * pre-session snapshot you can restore to.
 *
 *   user action            → session closed  (next agent action snapshots)
 *   agent action (1st)     → SNAPSHOT, session open
 *   agent action (2..n)    → no snapshot (session already open)
 *   user action            → session closed
 *   agent action           → SNAPSHOT again
 */

const DEFAULT_LIMIT = 20;

// ── capture ──────────────────────────────────────────────────────────────────

type SnapTicket = {
  id: string;
  columnId: string;
  number: number | null;
  title: string;
  description: string;
  position: number;
  priority: string;
  dueDate: string | null;
  assigneeType: string | null;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  createdByType: string;
  createdById: string | null;
  sourceNoteId: string | null;
  createdAt: string;
  labelIds: string[];
  comments: { id: string; authorType: string; authorId: string | null; authorName: string; body: string; createdAt: string }[];
};
type SnapBoard = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  icon: string;
  position: number;
  archived: boolean;
  isPublic: boolean;
  publicId: string | null;
  createdAt: string;
  labels: { id: string; name: string; color: string }[];
  columns: { id: string; name: string; position: number; wipLimit: number | null; isDone: boolean }[];
  tickets: SnapTicket[];
};

/** Serialize every board (with columns, tickets, labels, comments) in a workspace. */
export async function captureWorkspaceBoards(workspaceId: string): Promise<{ boards: SnapBoard[]; boardCount: number; ticketCount: number }> {
  const boards = await db.board.findMany({
    where: { workspaceId },
    orderBy: { position: "asc" },
    include: {
      labels: true,
      columns: { orderBy: { position: "asc" } },
      tickets: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        include: { labels: { select: { labelId: true } }, comments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  let ticketCount = 0;
  const payload: SnapBoard[] = boards.map((b) => {
    ticketCount += b.tickets.length;
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      color: b.color,
      icon: b.icon,
      position: b.position,
      archived: b.archived,
      isPublic: b.isPublic,
      publicId: b.publicId,
      createdAt: b.createdAt.toISOString(),
      labels: b.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
      columns: b.columns.map((c) => ({ id: c.id, name: c.name, position: c.position, wipLimit: c.wipLimit, isDone: c.isDone })),
      tickets: b.tickets.map((t) => ({
        id: t.id,
        columnId: t.columnId,
        number: t.number,
        title: t.title,
        description: t.description,
        position: t.position,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        assigneeType: t.assigneeType,
        assigneeUserId: t.assigneeUserId,
        assigneeAgentId: t.assigneeAgentId,
        createdByType: t.createdByType,
        createdById: t.createdById,
        sourceNoteId: t.sourceNoteId,
        createdAt: t.createdAt.toISOString(),
        labelIds: t.labels.map((tl) => tl.labelId),
        comments: t.comments.map((c) => ({
          id: c.id,
          authorType: c.authorType,
          authorId: c.authorId,
          authorName: c.authorName,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
      })),
    };
  });
  return { boards: payload, boardCount: boards.length, ticketCount };
}

// ── create + prune ───────────────────────────────────────────────────────────

export async function createSnapshot(
  workspaceId: string,
  opts: { kind?: string; reason?: string; agentId?: string | null; agentName?: string | null },
) {
  const cap = await captureWorkspaceBoards(workspaceId);
  const snap = await db.snapshot.create({
    data: {
      workspaceId,
      kind: opts.kind ?? "manual",
      reason: opts.reason ?? "",
      agentId: opts.agentId ?? null,
      agentName: opts.agentName ?? null,
      payload: JSON.stringify({ boards: cap.boards }),
      boardCount: cap.boardCount,
      ticketCount: cap.ticketCount,
    },
  });
  await pruneSnapshots(workspaceId);
  return snap;
}

/** Keep only the newest `snapshotLimit` snapshots per workspace. */
async function pruneSnapshots(workspaceId: string) {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { snapshotLimit: true } });
  const limit = Math.min(200, Math.max(1, ws?.snapshotLimit ?? DEFAULT_LIMIT));
  const stale = await db.snapshot.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    skip: limit,
    select: { id: true },
  });
  if (stale.length) await db.snapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
}

// ── session hooks ─────────────────────────────────────────────────────────────

/**
 * Called at the start of an AGENT board mutation. Atomically claims the session
 * (only the first concurrent caller flips false→true) and snapshots once.
 */
export async function guardAgentSnapshot(workspaceId: string, agent: { id?: string | null; name: string }) {
  const claimed = await db.workspace.updateMany({
    where: { id: workspaceId, agentSessionActive: false },
    data: { agentSessionActive: true },
  });
  if (claimed.count !== 1) return; // another action already opened this session
  try {
    await createSnapshot(workspaceId, {
      kind: "auto",
      reason: `Before ${agent.name} session`,
      agentId: agent.id ?? null,
      agentName: agent.name,
    });
  } catch (e) {
    // If capture failed, release the claim so the next agent action retries —
    // never strand a session "open" with no snapshot to restore to.
    await db.workspace
      .updateMany({ where: { id: workspaceId, agentSessionActive: true }, data: { agentSessionActive: false } })
      .catch(() => {});
    throw e;
  }
}

/** Called on a manual (user) board mutation — closes the agent session so the next agent action snapshots again. */
export async function markManualAction(workspaceId: string) {
  await db.workspace.updateMany({
    where: { id: workspaceId, agentSessionActive: true },
    data: { agentSessionActive: false },
  });
}

/** Single entry point for the service layer: branch on actor type. */
export async function onMutation(actor: Actor, workspaceId: string) {
  if (actor.type === "agent") {
    await guardAgentSnapshot(workspaceId, { id: actor.id, name: actor.name });
  } else if (actor.type === "user") {
    await markManualAction(workspaceId);
  }
}

// ── list / restore ─────────────────────────────────────────────────────────────

export type SnapshotMeta = {
  id: string;
  kind: string;
  reason: string;
  agentName: string | null;
  boardCount: number;
  ticketCount: number;
  createdAt: string;
};

export async function listSnapshots(workspaceId: string): Promise<SnapshotMeta[]> {
  const rows = await db.snapshot.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, reason: true, agentName: true, boardCount: true, ticketCount: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function deleteSnapshot(snapshotId: string, workspaceId: string) {
  const snap = await db.snapshot.findUnique({ where: { id: snapshotId }, select: { workspaceId: true } });
  if (!snap || snap.workspaceId !== workspaceId) throw new HttpError(404, "Snapshot not found");
  await db.snapshot.delete({ where: { id: snapshotId } });
}

/**
 * Restore a workspace's boards to a snapshot. Boards present in the snapshot are
 * rebuilt to match it (preserving ids so note→ticket links survive); boards
 * created after the snapshot are left untouched. Takes a pre-restore snapshot
 * first so the restore itself is undoable.
 */
export async function restoreSnapshot(snapshotId: string, workspaceId: string) {
  const snap = await db.snapshot.findUnique({ where: { id: snapshotId } });
  if (!snap || snap.workspaceId !== workspaceId) throw new HttpError(404, "Snapshot not found");

  // Safety net: capture current state before we overwrite it, and close any agent session.
  await createSnapshot(workspaceId, { kind: "pre_restore", reason: "Before restoring a snapshot" });
  await markManualAction(workspaceId);

  let payload: { boards: SnapBoard[] };
  try {
    payload = JSON.parse(snap.payload);
  } catch {
    throw new HttpError(422, "Snapshot payload is corrupt");
  }

  // Do all reads/sanitization first, then apply every board's writes in ONE
  // transaction — so a failure on any board rolls the whole restore back to the
  // pre-restore state rather than leaving the workspace half-restored.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const b of payload.boards) {
    ops.push(...(await buildBoardRestoreOps(workspaceId, b)));
  }
  await db.$transaction(ops);
  return snap;
}

async function buildBoardRestoreOps(workspaceId: string, b: SnapBoard): Promise<Prisma.PrismaPromise<unknown>[]> {
  // Sanitize references that may no longer be valid so re-creating rows can't
  // violate a foreign key or a unique constraint and abort the transaction.
  const userRefs = new Set<string>();
  const agentRefs = new Set<string>();
  const noteRefs = new Set<string>();
  for (const t of b.tickets) {
    if (t.assigneeUserId) userRefs.add(t.assigneeUserId);
    if (t.createdById) userRefs.add(t.createdById);
    if (t.assigneeAgentId) agentRefs.add(t.assigneeAgentId);
    if (t.sourceNoteId) noteRefs.add(t.sourceNoteId);
  }
  const [users, agents, notes, claimed, slugClash] = await Promise.all([
    userRefs.size ? db.user.findMany({ where: { id: { in: [...userRefs] } }, select: { id: true } }) : Promise.resolve([]),
    agentRefs.size ? db.agent.findMany({ where: { id: { in: [...agentRefs] } }, select: { id: true } }) : Promise.resolve([]),
    noteRefs.size ? db.note.findMany({ where: { id: { in: [...noteRefs] } }, select: { id: true } }) : Promise.resolve([]),
    // Source notes already claimed by a surviving ticket on a DIFFERENT board
    // (sourceNoteId is globally @unique) — re-using them here would conflict.
    noteRefs.size
      ? db.ticket.findMany({
          where: { sourceNoteId: { in: [...noteRefs] }, boardId: { not: b.id } },
          select: { sourceNoteId: true },
        })
      : Promise.resolve([]),
    // Another board grabbing this board's slug while it was gone (workspaceId+slug @unique).
    db.board.findFirst({ where: { workspaceId, slug: b.slug, id: { not: b.id } }, select: { id: true } }),
  ]);
  const validUsers = new Set(users.map((u) => u.id));
  const validAgents = new Set(agents.map((a) => a.id));
  const validNotes = new Set(notes.map((n) => n.id));
  const claimedNotes = new Set(claimed.map((c) => c.sourceNoteId));
  const slug = slugClash ? `${b.slug}-r${shortId(4)}` : b.slug;

  return [
    // Ensure the board row exists with the snapshot's metadata (update keeps the
    // existing slug; create uses the de-conflicted slug).
    db.board.upsert({
      where: { id: b.id },
      update: {
        name: b.name,
        description: b.description,
        color: b.color,
        icon: b.icon,
        position: b.position,
        archived: b.archived,
        isPublic: b.isPublic,
        publicId: b.publicId,
      },
      create: {
        id: b.id,
        workspaceId,
        name: b.name,
        slug,
        description: b.description,
        color: b.color,
        icon: b.icon,
        position: b.position,
        archived: b.archived,
        isPublic: b.isPublic,
        publicId: b.publicId,
        createdAt: new Date(b.createdAt),
      },
    }),
    // Wipe current content (cascades tickets → ticketLabels/comments).
    db.column.deleteMany({ where: { boardId: b.id } }),
    db.label.deleteMany({ where: { boardId: b.id } }),
    // Recreate labels, then columns, then tickets, then ticket-labels, then comments.
    ...b.labels.map((l) => db.label.create({ data: { id: l.id, boardId: b.id, name: l.name, color: l.color } })),
    ...b.columns.map((c) =>
      db.column.create({
        data: { id: c.id, boardId: b.id, name: c.name, position: c.position, wipLimit: c.wipLimit, isDone: c.isDone },
      }),
    ),
    ...b.tickets.map((t) =>
      db.ticket.create({
        data: {
          id: t.id,
          boardId: b.id,
          columnId: t.columnId,
          number: t.number,
          title: t.title,
          description: t.description,
          position: t.position,
          priority: t.priority,
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
          assigneeType: t.assigneeType,
          assigneeUserId: t.assigneeUserId && validUsers.has(t.assigneeUserId) ? t.assigneeUserId : null,
          assigneeAgentId: t.assigneeAgentId && validAgents.has(t.assigneeAgentId) ? t.assigneeAgentId : null,
          createdByType: t.createdByType,
          createdById: t.createdById && validUsers.has(t.createdById) ? t.createdById : null,
          sourceNoteId:
            t.sourceNoteId && validNotes.has(t.sourceNoteId) && !claimedNotes.has(t.sourceNoteId)
              ? t.sourceNoteId
              : null,
          createdAt: new Date(t.createdAt),
        },
      }),
    ),
    ...b.tickets.flatMap((t) =>
      t.labelIds
        .filter((lid) => b.labels.some((l) => l.id === lid))
        .map((labelId) => db.ticketLabel.create({ data: { ticketId: t.id, labelId } })),
    ),
    ...b.tickets.flatMap((t) =>
      t.comments.map((c) =>
        db.comment.create({
          data: {
            id: c.id,
            ticketId: t.id,
            authorType: c.authorType,
            authorId: c.authorId,
            authorName: c.authorName,
            body: c.body,
            createdAt: new Date(c.createdAt),
          },
        }),
      ),
    ),
  ];
}
