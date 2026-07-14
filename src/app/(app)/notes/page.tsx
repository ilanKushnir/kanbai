import { Suspense } from "react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { startOfDay } from "@/lib/notes-schedule";
import { listNotesForUser } from "@/lib/services/notes";
import { parseUserSettings } from "@/lib/user-settings";
import { NotesViewClient } from "@/components/notes/notes-view-client";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const ctx = await getContext();
  const { weekStartsOn, handedness, dictationLanguage } = parseUserSettings(ctx.user.settings);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [notes, agents, boards, dueTickets, actionLogs] = await Promise.all([
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
    // (read-through) into the Notes time-sections under their due day. Completed
    // tickets stop reflecting once their due day has passed, so dead strikethrough
    // rows don't pile up in "Today" forever.
    db.ticket.findMany({
      where: {
        deletedAt: null,
        dueDate: { not: null },
        board: boardWhereForContext(ctx),
        OR: [{ column: { isDone: false } }, { dueDate: { gte: startOfDay(new Date()) } }],
      },
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
    db.activityLog.findMany({
      where: { action: "note.sorted", createdAt: { gte: thirtyDaysAgo }, board: boardWhereForContext(ctx) },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, actorName: true, actorType: true, action: true, ticketId: true, meta: true, createdAt: true },
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

  const notesById = new Map(notes.map((n) => [n.id, n]));
  const ticketIds = [...new Set(actionLogs.map((a) => a.ticketId).filter((id): id is string => Boolean(id)))];
  const actionTickets = ticketIds.length
    ? await db.ticket.findMany({
        where: { id: { in: ticketIds }, deletedAt: null, board: boardWhereForContext(ctx) },
        select: { id: true, number: true, title: true, boardId: true, board: { select: { slug: true } } },
      })
    : [];
  const ticketById = new Map(actionTickets.map((t) => [t.id, t]));

  const recentActions = actionLogs
    .map((a) => {
      let noteId: string | null = null;
      try {
        const meta = a.meta ? (JSON.parse(a.meta) as { noteId?: unknown }) : null;
        noteId = typeof meta?.noteId === "string" ? meta.noteId : null;
      } catch {
        noteId = null;
      }
      const note = noteId ? notesById.get(noteId) : null;
      const ticket = a.ticketId ? ticketById.get(a.ticketId) : null;
      return {
        id: a.id,
        actorName: a.actorName,
        actorType: a.actorType,
        action: a.action,
        noteBody: note?.body ?? "Note filed into a ticket",
        resourceHref: ticket ? `/boards/${ticket.board.slug}?ticket=${ticket.id}` : null,
        resourceLabel: ticket ? `#${ticket.number ?? ""} ${ticket.title}`.trim() : null,
        createdAt: a.createdAt.toISOString(),
      };
    })
    .filter((a) => a.noteBody);

  // Historical installs only started emitting note.sorted activity recently; until
  // logs fill in, fall back to sorted notes so the section is still useful.
  const fallbackActions = recentActions.length
    ? []
    : notes
        .filter((n) => n.status === "sorted")
        .slice()
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 12)
        .map((n) => ({
          id: `note-${n.id}`,
          actorName: n.assignedAgent?.name ?? "Kanbai",
          actorType: n.assignedAgent ? "agent" : "system",
          action: "note.sorted",
          noteBody: n.body,
          resourceHref: n.ticket ? `/boards/${boards.find((b) => b.id === n.ticket?.boardId)?.slug ?? ""}?ticket=${n.ticket.id}` : null,
          resourceLabel: n.ticket?.title ?? null,
          createdAt: n.updatedAt,
        }));

  return (
    <Suspense fallback={null}>
      <NotesViewClient
        notes={notes}
        agents={agents}
        boards={boards}
        reflections={reflections}
        recentActions={recentActions.length ? recentActions : fallbackActions}
        weekStartsOn={weekStartsOn}
        handedness={handedness}
        dictationLanguage={dictationLanguage}
      />
    </Suspense>
  );
}
