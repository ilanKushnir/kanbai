import Link from "next/link";
import type { Metadata } from "next";
import { Columns3, NotebookPen, Bot, Users } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { parseUserSettings } from "@/lib/user-settings";
import type { BoardCardData } from "@/lib/board-directory";
import { KanbaiMark } from "@/components/brand/Logo";
import { NewBoardButton } from "@/components/board/new-board-modal";
import { ArchivedBoards } from "@/components/board/archived-boards";
import { BoardsDirectory } from "@/components/board/boards-directory";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Boards" };
export const dynamic = "force-dynamic";

export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const ctx = await getContext();
  const sp = await searchParams;

  // Managers can see + restore archived boards.
  const [boards, archivedBoards] = await Promise.all([
    db.board.findMany({
      where: boardWhereForContext(ctx),
      orderBy: { position: "asc" },
      include: {
        columns: { select: { isDone: true, _count: { select: { tickets: true } } } },
        access: {
          select: { level: true, user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
        },
      },
    }),
    ctx.isManager
      ? db.board.findMany({
          where: { workspaceId: ctx.workspace.id, archived: true },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, slug: true, color: true },
        })
      : Promise.resolve([]),
  ]);

  const cards: BoardCardData[] = boards.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    color: b.color,
    isPublic: b.isPublic,
    ticketCount: b.columns.reduce((s, c) => s + c._count.tickets, 0),
    doneCount: b.columns.filter((c) => c.isDone).reduce((s, c) => s + c._count.tickets, 0),
    sharedWith: b.access.filter((a) => a.user.id !== ctx.user.id).map((a) => a.user),
    viewerLevel: ctx.isManager
      ? null
      : ((b.access.find((a) => a.user.id === ctx.user.id)?.level as "view" | "edit" | undefined) ??
        null),
  }));

  const { pinnedBoardIds } = parseUserSettings(ctx.user.settings);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 max-w-6xl mx-auto w-full">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Boards</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Serious Kanban for projects you and your agents run together.
          </p>
        </div>
        {ctx.isManager && <NewBoardButton defaultOpen={sp.new === "1"} />}
      </header>

      {cards.length === 0 && !ctx.isManager ? (
        <EmptyState
          className="mt-6"
          icon={Users}
          title="No boards shared with you yet"
          description="You'll see boards here once a workspace owner or admin shares one with you."
          action={
            <Link
              href="/notes"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <NotebookPen className="h-4 w-4" /> Capture a note meanwhile
            </Link>
          }
        />
      ) : cards.length === 0 ? (
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
              <p className="mt-1 text-xs text-fg-muted">Hermes &amp; friends, via self-registered webhooks.</p>
            </Link>
          </div>
          <p className="hidden border-t border-border px-6 py-3 text-center text-xs text-fg-subtle md:block">
            Tip: press <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5">⌘K</kbd> anywhere to search or jump.
          </p>
        </div>
      ) : (
        <BoardsDirectory boards={cards} pinnedBoardIds={pinnedBoardIds} isManager={ctx.isManager} />
      )}

      {ctx.isManager && <ArchivedBoards boards={archivedBoards} />}
    </div>
  );
}
