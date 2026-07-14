import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { boardWhereForContext, assertTicketAccess } from "@/lib/authz";
import { htmlToPlainText } from "@/lib/utils";
import type { Context } from "@/lib/auth";

/** How long soft-deleted notes & tickets are kept before being purged for good. */
export const TRASH_DAYS = 30;

function cutoff() {
  return new Date(Date.now() - TRASH_DAYS * 86_400_000);
}

/** Hard-delete anything that has sat in the trash past the retention window. */
export async function purgeExpiredTrash() {
  const before = cutoff();
  await db.note.deleteMany({ where: { deletedAt: { lt: before } } });
  await db.ticket.deleteMany({ where: { deletedAt: { lt: before } } });
}

export type TrashList = {
  notes: { id: string; body: string; deletedAt: string }[];
  tickets: { id: string; title: string; number: number | null; board: string; boardSlug: string; deletedAt: string }[];
};

/** Recently-deleted notes (the user's) and tickets (boards they can access). */
export async function listTrash(ctx: Context): Promise<TrashList> {
  await purgeExpiredTrash(); // opportunistic cleanup — no cron needed
  const since = cutoff();
  const [notes, tickets] = await Promise.all([
    db.note.findMany({
      where: { userId: ctx.user.id, deletedAt: { gte: since } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, body: true, deletedAt: true },
    }),
    db.ticket.findMany({
      where: { board: boardWhereForContext(ctx), deletedAt: { gte: since } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, title: true, number: true, deletedAt: true, board: { select: { name: true, slug: true } } },
    }),
  ]);
  return {
    notes: notes.map((n) => ({
      id: n.id,
      body: htmlToPlainText(n.body).slice(0, 200),
      deletedAt: n.deletedAt!.toISOString(),
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      number: t.number,
      board: t.board.name,
      boardSlug: t.board.slug,
      deletedAt: t.deletedAt!.toISOString(),
    })),
  };
}

async function ownNote(ctx: Context, id: string) {
  const n = await db.note.findUnique({ where: { id }, select: { userId: true } });
  if (!n || n.userId !== ctx.user.id) throw new HttpError(404, "Note not found");
}

// ── agent API (workspace-scoped) ─────────────────────────────────────────────
// Agents see the whole workspace's trash: notes owned by any member, tickets on
// any of the workspace's boards. Restore only — permanent purge stays human-only.

export async function listTrashForWorkspace(
  workspaceId: string,
  include: { notes: boolean; tickets: boolean },
): Promise<TrashList> {
  await purgeExpiredTrash(); // opportunistic cleanup — no cron needed
  const since = cutoff();
  const [notes, tickets] = await Promise.all([
    include.notes
      ? db.note.findMany({
          where: { user: { workspaces: { some: { workspaceId } } }, deletedAt: { gte: since } },
          orderBy: { deletedAt: "desc" },
          select: { id: true, body: true, deletedAt: true },
        })
      : [],
    include.tickets
      ? db.ticket.findMany({
          where: { board: { workspaceId }, deletedAt: { gte: since } },
          orderBy: { deletedAt: "desc" },
          select: { id: true, title: true, number: true, deletedAt: true, board: { select: { name: true, slug: true } } },
        })
      : [],
  ]);
  return {
    notes: notes.map((n) => ({
      id: n.id,
      body: htmlToPlainText(n.body).slice(0, 200),
      deletedAt: n.deletedAt!.toISOString(),
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      number: t.number,
      board: t.board.name,
      boardSlug: t.board.slug,
      deletedAt: t.deletedAt!.toISOString(),
    })),
  };
}

export async function restoreNoteInWorkspace(workspaceId: string, id: string) {
  const n = await db.note.findUnique({ where: { id }, select: { userId: true, deletedAt: true } });
  if (!n) throw new HttpError(404, "Note not found");
  const member = await db.workspaceMember.findFirst({ where: { workspaceId, userId: n.userId }, select: { id: true } });
  if (!member) throw new HttpError(404, "Note not found");
  if (!n.deletedAt) throw new HttpError(422, "Note is not in the trash", "not_deleted");
  await db.note.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreTicketInWorkspace(workspaceId: string, id: string) {
  const t = await db.ticket.findUnique({
    where: { id },
    select: { deletedAt: true, board: { select: { workspaceId: true } } },
  });
  if (!t || t.board.workspaceId !== workspaceId) throw new HttpError(404, "Ticket not found");
  if (!t.deletedAt) throw new HttpError(422, "Ticket is not in the trash", "not_deleted");
  await db.ticket.update({ where: { id }, data: { deletedAt: null } });
}

export async function restoreNote(ctx: Context, id: string) {
  await ownNote(ctx, id);
  await db.note.update({ where: { id }, data: { deletedAt: null } });
}
export async function purgeNote(ctx: Context, id: string) {
  await ownNote(ctx, id);
  await db.note.delete({ where: { id } });
}
export async function restoreTicket(ctx: Context, id: string) {
  await assertTicketAccess(ctx, id, true);
  await db.ticket.update({ where: { id }, data: { deletedAt: null } });
}
export async function purgeTicket(ctx: Context, id: string) {
  await assertTicketAccess(ctx, id, true);
  await db.ticket.delete({ where: { id } });
}
