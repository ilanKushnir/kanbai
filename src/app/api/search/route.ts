import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const { workspace, user } = await getCurrentContext();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return ok({ boards: [], tickets: [], notes: [] });

  // SQLite LIKE is case-insensitive for ASCII, so `contains` works for fuzzy-ish search.
  const [boards, tickets, notes] = await Promise.all([
    db.board.findMany({
      where: { workspaceId: workspace.id, archived: false, name: { contains: q } },
      take: 5,
      select: { id: true, name: true, slug: true, color: true },
    }),
    db.ticket.findMany({
      where: { board: { workspaceId: workspace.id }, title: { contains: q } },
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
      where: { userId: user!.id, body: { contains: q }, status: { not: "archived" } },
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
