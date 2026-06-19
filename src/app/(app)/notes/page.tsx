import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { listNotesForUser } from "@/lib/services/notes";
import { parseUserSettings } from "@/lib/user-settings";
import { NotesViewClient } from "@/components/notes/notes-view-client";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const ctx = await getContext();
  const { weekStartsOn } = parseUserSettings(ctx.user.settings);

  const [notes, agents, boards] = await Promise.all([
    listNotesForUser(ctx.user.id),
    db.agent.findMany({
      where: { workspaceId: ctx.workspace.id, status: "active" },
      select: { id: true, name: true, color: true, kind: true },
      orderBy: { createdAt: "asc" },
    }),
    db.board.findMany({
      where: boardWhereForContext(ctx),
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } },
        labels: { select: { id: true, name: true, color: true } },
      },
    }),
  ]);

  return (
    <Suspense fallback={null}>
      <NotesViewClient notes={notes} agents={agents} boards={boards} weekStartsOn={weekStartsOn} />
    </Suspense>
  );
}
