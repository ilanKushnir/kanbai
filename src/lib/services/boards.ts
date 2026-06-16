import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { ticketInclude, serializeTicket, type UserLite } from "@/lib/serialize";
import type { Actor } from "./tickets";

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
          tickets: { orderBy: { position: "asc" }, include: ticketInclude },
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
    labels: board.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    columns: board.columns.map((c) => ({
      id: c.id,
      name: c.name,
      isDone: c.isDone,
      wipLimit: c.wipLimit,
      tickets: c.tickets.map((t) => serializeTicket(t, usersById)),
    })),
  };
}

export type BoardData = Awaited<ReturnType<typeof getBoardWithData>>;
