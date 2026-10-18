import Link from "next/link";
import type { Metadata } from "next";
import { ThemedArt } from "@/components/ui/themed-art";
import { Sparkles, Sun, Users } from "lucide-react";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { parseUserSettings } from "@/lib/user-settings";
import type { BoardCardData } from "@/lib/board-directory";
import { NewBoardButton } from "@/components/board/new-board-modal";
import { ArchivedBoards } from "@/components/board/archived-boards";
import { BoardsDirectory } from "@/components/board/boards-directory";
import { OtherWorkspaceBoards, type OtherWorkspaceGroup } from "@/components/board/other-workspace-boards";
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

  const others = ctx.memberships.filter((m) => m.workspace.id !== ctx.workspace.id);

  // Managers can see + restore archived boards.
  const [boards, archivedBoards, otherBoards] = await Promise.all([
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
    // What the viewer can open in their other workspaces (shared boards live there).
    others.length
      ? db.board.findMany({
          where: {
            archived: false,
            OR: others.map((m) =>
              m.role === "member"
                ? { workspaceId: m.workspace.id, access: { some: { userId: ctx.user.id } } }
                : { workspaceId: m.workspace.id },
            ),
          },
          orderBy: { position: "asc" },
          select: { id: true, name: true, slug: true, color: true, workspaceId: true },
        })
      : Promise.resolve([]),
  ]);

  const otherGroups: OtherWorkspaceGroup[] = others
    .map((m) => ({
      workspaceId: m.workspace.id,
      workspaceName: m.workspace.name,
      boards: otherBoards.filter((b) => b.workspaceId === m.workspace.id),
    }))
    .filter((g) => g.boards.length > 0);

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
          <h1 className="font-display text-[2rem] font-medium leading-tight">Boards</h1>
          <p className="mt-1 text-sm text-fg-muted">One board per project. Dated tickets show up on Today.</p>
        </div>
        {ctx.isManager && <NewBoardButton defaultOpen={sp.new === "1"} />}
      </header>

      {cards.length === 0 && otherGroups.length > 0 && <OtherWorkspaceBoards groups={otherGroups} className="mb-8" />}

      {cards.length === 0 && !ctx.isManager ? (
        <EmptyState
          className="mt-6"
          icon={Users}
          title="No boards shared with you yet"
          description="You'll see boards here once a workspace owner or admin shares one with you."
          action={
            <Link
              href="/today"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <Sun className="h-4 w-4" /> Back to Today
            </Link>
          }
        />
      ) : cards.length === 0 ? (
        <div className="mt-6 grid gap-6 overflow-hidden rounded-2xl border border-border bg-surface md:grid-cols-[18rem_1fr]">
          <div className="relative h-48 md:h-auto">
            <ThemedArt name="empty-board" sizes="(min-width: 768px) 288px, 100vw" className="object-cover" />
          </div>
          <div className="p-6 md:py-8">
            <h2 className="font-display text-2xl font-medium">Your first board</h2>
            <p className="mt-2 max-w-md text-sm text-fg-muted">
              A board is a project: a few columns, tickets that move left to right, and a Done column. Anything with a due date
              also shows up on Today, so you never have to open a board to know what&apos;s next.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <NewBoardButton />
              {ctx.isManager && (
                <Link href="/agents" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-2">
                  <Sparkles className="h-4 w-4" /> Or let your agent create one
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : (
        <BoardsDirectory boards={cards} pinnedBoardIds={pinnedBoardIds} isManager={ctx.isManager} />
      )}

      {cards.length > 0 && <OtherWorkspaceBoards groups={otherGroups} className="mt-8" />}

      {ctx.isManager && <ArchivedBoards boards={archivedBoards} />}
    </div>
  );
}
