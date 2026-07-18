import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { assertBoardAccess } from "@/lib/authz";
import { getBoardWithData } from "@/lib/services/boards";
import { boardAssigneeUsers } from "@/lib/services/board-members";
import { parseUserSettings } from "@/lib/user-settings";
import { BoardViewClient } from "@/components/board/board-view-client";
import { ShareButton } from "@/components/board/share-button";
import { BoardSettings } from "@/components/board/board-settings";
import { BoardMembers } from "@/components/board/board-members";
import { tone } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await getContext();
  const board = await db.board.findFirst({
    where: { workspaceId: ctx.workspace.id, slug },
    select: { name: true },
  });
  return { title: board?.name ?? "Board" };
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ticket?: string; from?: string }>;
}) {
  const { slug } = await params;
  const { ticket: initialTicketId, from } = await searchParams;
  const ctx = await getContext();

  let board;
  try {
    board = await getBoardWithData(ctx.workspace.id, { slug });
    await assertBoardAccess(ctx, board.id); // members need an explicit grant
  } catch {
    notFound();
  }

  const agentRows = await db.agent.findMany({
    where: { workspaceId: ctx.workspace.id, status: "active" },
    select: {
      id: true,
      name: true,
      color: true,
      kind: true,
      ownerUserId: true,
      ownerUser: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const agents = agentRows.map(({ ownerUser, ...a }) => ({ ...a, ownerName: ownerUser?.name ?? null }));

  // Humans this board's tickets can be assigned to: managers + shared members.
  const members = await boardAssigneeUsers(board.id);
  const { weekStartsOn } = parseUserSettings(ctx.user.settings);

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
          {board.isPublic && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[0.6875rem] font-medium text-success">
              public
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <BoardMembers boardId={board.id} boardName={board.name} />
            {ctx.isManager && (
              <>
                <ShareButton boardId={board.id} isPublic={board.isPublic} publicId={board.publicId} />
                <BoardSettings
                  boardId={board.id}
                  name={board.name}
                  description={board.description}
                  color={board.color}
                />
              </>
            )}
          </div>
        </div>
        {board.description && <p className="mt-1 text-sm text-fg-muted">{board.description}</p>}
      </header>

      <div className="min-h-0 flex-1">
        <BoardViewClient
          board={board}
          agents={agents}
          members={members}
          currentUser={{ id: ctx.user.id, name: ctx.user.name }}
          weekStartsOn={weekStartsOn}
          initialTicketId={initialTicketId}
          returnTo={from === "notes" ? "notes" : undefined}
        />
      </div>
    </div>
  );
}
