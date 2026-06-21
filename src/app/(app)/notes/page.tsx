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
  const { weekStartsOn, handedness, dictationLanguage } = parseUserSettings(ctx.user.settings);

  const [notes, agents, boards, dueTickets] = await Promise.all([
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
    // Tickets carrying a due date, scoped to boards the user can see — reflected
    // (read-through) into the Notes time-sections under their due day.
    db.ticket.findMany({
      where: { deletedAt: null, dueDate: { not: null }, board: boardWhereForContext(ctx) },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        boardId: true,
        number: true,
        title: true,
        priority: true,
        dueDate: true,
        board: { select: { name: true, color: true, slug: true } },
        column: { select: { isDone: true } },
      },
    }),
  ]);

  const reflections = dueTickets.map((t) => ({
    id: t.id,
    boardId: t.boardId,
    boardName: t.board.name,
    boardColor: t.board.color,
    boardSlug: t.board.slug,
    number: t.number,
    title: t.title,
    priority: t.priority,
    dueDate: t.dueDate!.toISOString(),
    done: t.column.isDone,
  }));

  return (
    <Suspense fallback={null}>
      <NotesViewClient
        notes={notes}
        agents={agents}
        boards={boards}
        reflections={reflections}
        weekStartsOn={weekStartsOn}
        handedness={handedness}
        dictationLanguage={dictationLanguage}
      />
    </Suspense>
  );
}
