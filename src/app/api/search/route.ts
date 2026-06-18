import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return ok({ boards: [], tickets: [], notes: [] });

  // Boards (and tickets within) the user may see.
  const boardScope = ctx.isManager
    ? { workspaceId: ctx.workspace.id }
    : { workspaceId: ctx.workspace.id, access: { some: { userId: ctx.user.id } } };

  const [boards, tickets, notes] = await Promise.all([
    db.board.findMany({
      where: { ...boardScope, archived: false, name: { contains: q } },
      take: 5,
      select: { id: true, name: true, slug: true, color: true },
    }),
    db.ticket.findMany({
      where: { board: { ...boardScope, archived: false }, title: { contains: q } },
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        priority: true,
        board: { select: { slug: true, name: true } },
        column: { select: { name: true } },
      },
    }),
    db.note.findMany({
      where: { userId: ctx.user.id, body: { contains: q }, status: { not: "archived" } },
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: { id: true, body: true, status: true },
    }),
  ]);

  return ok({
    boards,
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      boardSlug: t.board.slug,
      boardName: t.board.name,
      column: t.column?.name ?? "",
    })),
    notes: notes.map((n) => ({ id: n.id, body: n.body.slice(0, 120), status: n.status })),
  });
});
