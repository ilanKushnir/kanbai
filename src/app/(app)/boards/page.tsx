import Link from "next/link";
import type { Metadata } from "next";
import { Columns3, NotebookPen, Bot } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentContext } from "@/lib/auth";
import { tone } from "@/components/ui/badge";
import { KanbaiMark } from "@/components/brand/Logo";
import { NewBoardButton } from "@/components/board/new-board-modal";

export const metadata: Metadata = { title: "Boards" };
export const dynamic = "force-dynamic";

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
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="bg-brand-gradient px-6 py-8 text-white sm:px-8">
            <KanbaiMark variant="mono" className="h-10 w-10 text-white/90" />
            <h2 className="mt-3 text-xl font-bold tracking-tight">Welcome to Kanbai</h2>
            <p className="mt-1 max-w-md text-sm text-white/85">
              Capture fast, let agents sort, and keep serious Kanban when it counts. Here&apos;s how to start.
            </p>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
            <div className="rounded-xl border border-border p-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
                <Columns3 className="h-4.5 w-4.5" />
              </span>
              <h3 className="mt-2.5 text-sm font-semibold">Create a board</h3>
              <p className="mt-1 text-xs text-fg-muted">Columns, drag-and-drop, priorities, due dates.</p>
              <div className="mt-3">
                <NewBoardButton />
              </div>
            </div>
            <Link href="/notes" className="rounded-xl border border-border p-4 transition-colors hover:bg-surface-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
                <NotebookPen className="h-4.5 w-4.5" />
              </span>
              <h3 className="mt-2.5 text-sm font-semibold">Capture a note</h3>
              <p className="mt-1 text-xs text-fg-muted">Jot anything; send it to an agent to file it.</p>
            </Link>
            <Link href="/agents" className="rounded-xl border border-border p-4 transition-colors hover:bg-surface-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
                <Bot className="h-4.5 w-4.5" />
              </span>
              <h3 className="mt-2.5 text-sm font-semibold">Connect an agent</h3>
              <p className="mt-1 text-xs text-fg-muted">Hermes &amp; friends, with signed webhooks.</p>
            </Link>
          </div>
          <p className="border-t border-border px-6 py-3 text-center text-xs text-fg-subtle">
            Tip: press <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5">⌘K</kbd> anywhere to search or jump.
          </p>
        </div>
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
