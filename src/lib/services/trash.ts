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
