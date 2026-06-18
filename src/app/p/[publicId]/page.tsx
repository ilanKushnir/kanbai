import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicBoard } from "@/lib/services/boards";
import { Logo } from "@/components/brand/Logo";
import { PublicBoardView } from "@/components/board/public-board-view";
import { tone } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const board = await getPublicBoard(publicId);
  return {
    title: board ? `${board.name} · public board` : "Board not found",
    robots: { index: false },
  };
}

export default async function PublicBoardPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const board = await getPublicBoard(publicId);
  if (!board) notFound();

  const t = tone(board.color);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/70 px-4 backdrop-blur-md md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.dot }} />
          <h1 className="truncate text-base font-bold tracking-tight">{board.name}</h1>
          <span className="hidden shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-[0.6875rem] font-medium text-success sm:inline">
            public · read-only
          </span>
        </div>
        <Link
          href="/login"
          className="inline-flex shrink-0 items-center gap-2 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <span className="hidden sm:inline">Sign in</span>
          <Logo markClassName="h-6 w-6" showWordmark={false} />
        </Link>
      </header>

      {board.description && (
        <p className="shrink-0 px-4 pt-3 text-sm text-fg-muted md:px-6">{board.description}</p>
      )}

      <div className="min-h-0 flex-1 pt-3">
        <PublicBoardView board={board} />
      </div>

      <footer className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-fg-subtle">
        A public board on{" "}
        <Link href="/" className="font-medium text-fg-muted hover:text-fg">
          Kanbai
        </Link>{" "}
        · {board.workspaceName}
      </footer>
    </div>
  );
}
