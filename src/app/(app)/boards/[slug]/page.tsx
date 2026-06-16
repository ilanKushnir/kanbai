import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/auth";
import { getBoardWithData } from "@/lib/services/boards";
import { BoardViewClient } from "@/components/board/board-view-client";
import { tone } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { workspace } = await getCurrentContext();
  const board = await db.board.findFirst({
    where: { workspaceId: workspace.id, slug },
    select: { name: true },
  });
  return { title: board?.name ?? "Board" };
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ticket?: string }>;
}) {
  const { slug } = await params;
  const { ticket: initialTicketId } = await searchParams;
  const { workspace, user } = await getCurrentContext();

  let board;
  try {
    board = await getBoardWithData(workspace.id, { slug });
  } catch {
    notFound();
  }

  const agents = await db.agent.findMany({
    where: { workspaceId: workspace.id, status: "active" },
    select: { id: true, name: true, color: true, kind: true },
    orderBy: { createdAt: "asc" },
  });

  const total = board.columns.reduce((s, c) => s + c.tickets.length, 0);
  const t = tone(board.color);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-4 pt-6 pb-4 md:px-8">
        <div className="flex items-center gap-2.5">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.dot }} />
          <h1 className="text-xl font-bold tracking-tight">{board.name}</h1>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-subtle">
            {total}
          </span>
        </div>
        {board.description && <p className="mt-1 text-sm text-fg-muted">{board.description}</p>}
      </header>

      <div className="min-h-0 flex-1">
        <BoardViewClient
          board={board}
          agents={agents}
          currentUser={user ? { id: user.id, name: user.name } : null}
          initialTicketId={initialTicketId}
        />
      </div>
    </div>
  );
}
