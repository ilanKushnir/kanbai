import Link from "next/link";
import type { Metadata } from "next";
import { Columns3 } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/auth";
import { tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { NewBoardButton } from "@/components/board/new-board-modal";

export const metadata: Metadata = { title: "Boards" };

export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { workspace } = await getCurrentContext();
  const sp = await searchParams;

  const boards = await db.board.findMany({
    where: { workspaceId: workspace.id, archived: false },
    orderBy: { position: "asc" },
    include: {
      columns: { select: { isDone: true, _count: { select: { tickets: true } } } },
    },
  });

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl mx-auto w-full">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Boards</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Serious Kanban for projects you and your agents run together.
          </p>
        </div>
        <NewBoardButton defaultOpen={sp.new === "1"} />
      </header>

      {boards.length === 0 ? (
        <EmptyState
          icon={Columns3}
          title="No boards yet"
          description="Create your first board to start tracking work across columns."
          action={<NewBoardButton />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => {
            const total = b.columns.reduce((s, c) => s + c._count.tickets, 0);
            const done = b.columns
              .filter((c) => c.isDone)
              .reduce((s, c) => s + c._count.tickets, 0);
            const pct = total ? Math.round((done / total) * 100) : 0;
            const t = tone(b.color);
            return (
              <Link
                key={b.id}
                href={`/boards/${b.slug}`}
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card transition-all hover:border-border-strong hover:shadow-md"
              >
                <span
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: t.dot }}
                />
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ backgroundColor: t.bg }}>
                    <Columns3 className="h-4.5 w-4.5" style={{ color: t.dot }} />
                  </span>
                  <h2 className="text-base font-semibold tracking-tight">{b.name}</h2>
                </div>
                {b.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-fg-muted">{b.description}</p>
                )}

                <div className="mt-4 flex items-center justify-between text-xs text-fg-subtle">
                  <span>
                    {total} {total === 1 ? "ticket" : "tickets"}
                  </span>
                  <span>{pct}% done</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="block h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: t.dot }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
