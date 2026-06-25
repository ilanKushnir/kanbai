import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { shortToken } from "@/lib/password";
import { ticketInclude, serializeTicket, serializePublicTicket, type UserLite } from "@/lib/serialize";
import { parseSubStates, stringifySubStates } from "@/lib/substates";
import { onMutation } from "@/lib/snapshots";
import { reconcileColumnSubStates, type Actor } from "./tickets";

async function uniqueBoardSlug(workspaceId: string, name: string) {
  const base = slugify(name);
  const existing = await db.board.findMany({
    where: { workspaceId, slug: { startsWith: base } },
    select: { slug: true },
  });
  return existing.some((b) => b.slug === base) ? `${base}-${existing.length + 1}` : base;
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "board"
  );
}

const DEFAULT_COLUMNS = [
  { name: "Backlog", isDone: false },
  { name: "To Do", isDone: false },
  { name: "In Progress", isDone: false },
  { name: "Done", isDone: true },
];

export async function createBoard(
  workspaceId: string,
  input: { name: string; description?: string; color?: string },
  actor: Actor,
) {
  await onMutation(actor, workspaceId);
  let slug = slugify(input.name);
  // ensure unique within workspace
  const existing = await db.board.findMany({
    where: { workspaceId, slug: { startsWith: slug } },
    select: { slug: true },
  });
  if (existing.some((b) => b.slug === slug)) slug = `${slug}-${existing.length + 1}`;

  const count = await db.board.count({ where: { workspaceId } });
  const board = await db.board.create({
    data: {
      workspaceId,
      name: input.name,
      slug,
      description: input.description,
      color: input.color ?? "iris",
      position: count,
      columns: { create: DEFAULT_COLUMNS.map((c, i) => ({ ...c, position: i })) },
    },
  });

  await logActivity({ actor, action: "board.created", boardId: board.id, meta: { name: board.name } });
  return board;
}

/** Full board payload for the Kanban page or agent API. */
export async function getBoardWithData(
  workspaceId: string,
  ident: { slug?: string; id?: string },
) {
  const board = await db.board.findFirst({
    where: { workspaceId, ...(ident.id ? { id: ident.id } : { slug: ident.slug }) },
    include: {
      labels: true,
      columns: {
        orderBy: { position: "asc" },
        include: {
          tickets: { where: { deletedAt: null }, orderBy: { position: "asc" }, include: ticketInclude },
        },
      },
    },
  });
  if (!board) throw new HttpError(404, "Board not found");

  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: true },
  });
  const usersById = new Map<string, UserLite>(
    members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl }]),
  );

  return {
    id: board.id,
    name: board.name,
    slug: board.slug,
    description: board.description,
    color: board.color,
    icon: board.icon,
    archived: board.archived,
    isPublic: board.isPublic,
    publicId: board.publicId,
    labels: board.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    columns: board.columns.map((c) => ({
      id: c.id,
      name: c.name,
      isDone: c.isDone,
      wipLimit: c.wipLimit,
      subStates: parseSubStates(c.subStates),
      tickets: c.tickets.map((t) => serializeTicket(t, usersById)),
    })),
  };
}

export type BoardData = Awaited<ReturnType<typeof getBoardWithData>>;

/** Create a board with custom columns + labels (used by the migration agent API). */
export async function createBoardWithStructure(
  workspaceId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    columns?: { name: string; isDone?: boolean }[];
    labels?: { name: string; color?: string }[];
    createdAt?: string | null;
  },
  actor: Actor,
) {
  await onMutation(actor, workspaceId);
  const slug = await uniqueBoardSlug(workspaceId, input.name);
  const count = await db.board.count({ where: { workspaceId } });
  const cols = input.columns?.length ? input.columns : DEFAULT_COLUMNS;
  const board = await db.board.create({
    data: {
      workspaceId,
      name: input.name,
      slug,
      description: input.description,
      color: input.color ?? "iris",
      position: count,
      ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      columns: { create: cols.map((c, i) => ({ name: c.name, isDone: c.isDone ?? false, position: i })) },
      labels: input.labels?.length
        ? { create: input.labels.map((l) => ({ name: l.name, color: l.color ?? "slate" })) }
        : undefined,
    },
    include: {
      columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } },
      labels: { select: { id: true, name: true, color: true } },
    },
  });
  await logActivity({ actor, action: "board.created", boardId: board.id, meta: { name: board.name } });
  return board;
}

/**
 * Update a single column's editable fields (name, sub-states, done-flag, WIP
 * limit) from the agent API. Caller must have already asserted the column lives
 * in the board/workspace. Only the fields present in `input` are touched, so a
 * partial PATCH never clobbers the rest of the column. Returns the readback.
 */
export async function updateBoardColumn(
  workspaceId: string,
  boardId: string,
  columnId: string,
  input: { name?: string; isDone?: boolean; wipLimit?: number | null; subStates?: string[] },
  actor: Actor,
) {
  await onMutation(actor, workspaceId);
  if (input.name !== undefined) {
    // SQLite's Prisma connector has no `mode: "insensitive"` filter, so compare
    // case-insensitively in JS over the board's other columns instead.
    const wanted = input.name.trim().toLowerCase();
    const siblings = await db.column.findMany({
      where: { boardId, id: { not: columnId } },
      select: { name: true },
    });
    if (siblings.some((c) => c.name.trim().toLowerCase() === wanted)) {
      throw new HttpError(409, "A column with that name already exists on this board.", "column_name_conflict");
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.isDone !== undefined) data.isDone = input.isDone;
  if (input.wipLimit !== undefined) data.wipLimit = input.wipLimit;
  // subStates is the whole list for this column — normalized (trimmed, de-duped
  // case-insensitively, capped) before it's stored. Sending [] clears them.
  if (input.subStates !== undefined) data.subStates = stringifySubStates(input.subStates);

  const column = await db.column.update({ where: { id: columnId }, data });
  // Changing the band list can orphan tickets' sub-states — snap them back valid.
  if (input.subStates !== undefined) await reconcileColumnSubStates(columnId);
  await logActivity({
    actor,
    action: "column.updated",
    boardId: column.boardId,
    meta: { columnId, fields: Object.keys(data) },
  });
  return {
    id: column.id,
    name: column.name,
    isDone: column.isDone,
    wipLimit: column.wipLimit,
    position: column.position,
    subStates: parseSubStates(column.subStates),
  };
}

/** Toggle a board's public visibility; mints a stable publicId the first time. */
export async function setBoardPublic(boardId: string, isPublic: boolean) {
  const board = await db.board.findUnique({ where: { id: boardId }, select: { slug: true, publicId: true } });
  if (!board) throw new HttpError(404, "Board not found");
  const data: { isPublic: boolean; publicId?: string } = { isPublic };
  // Readable slug prefix + a high-entropy, mixed-case suffix so the URL can't be guessed.
  if (isPublic && !board.publicId) data.publicId = `${board.slug}-${shortToken(16)}`;
  const updated = await db.board.update({
    where: { id: boardId },
    data,
    select: { id: true, isPublic: true, publicId: true },
  });
  return updated;
}

/** Read-only board payload for the public (no-auth) page. Returns null if not public. */
export async function getPublicBoard(publicId: string) {
  const board = await db.board.findUnique({
    where: { publicId },
    include: {
      labels: true,
      workspace: { select: { name: true } },
      columns: {
        orderBy: { position: "asc" },
        include: { tickets: { where: { deletedAt: null }, orderBy: { position: "asc" }, include: ticketInclude } },
      },
    },
  });
  // Archiving a board retires it everywhere — including its public URL.
  if (!board || !board.isPublic || board.archived) return null;

  const members = await db.workspaceMember.findMany({
    where: { workspaceId: board.workspaceId },
    include: { user: true },
  });
  const usersById = new Map<string, UserLite>(
    members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl }]),
  );

  return {
    name: board.name,
    description: board.description,
    color: board.color,
    workspaceName: board.workspace.name,
    columns: board.columns.map((c) => ({
      id: c.id,
      name: c.name,
      isDone: c.isDone,
      tickets: c.tickets.map((t) => serializePublicTicket(t, usersById)),
    })),
  };
}

export type PublicBoardData = NonNullable<Awaited<ReturnType<typeof getPublicBoard>>>;
