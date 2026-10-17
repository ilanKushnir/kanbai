import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth";
import { boardWhereForContext } from "@/lib/authz";
import { type UserLite } from "@/lib/serialize";
import { listNotesForUser } from "@/lib/services/notes";
import { isTaskNote, loadTicketModal, ticketRowInclude, toNoteRow, toTicketRow } from "@/lib/services/task-rows";
import { parseUserSettings } from "@/lib/user-settings";
import { addDays, startOfDay, ymd } from "@/lib/notes-schedule";
import { PlanView, type PlanBoard } from "@/components/plan/plan-view";
import { TodayTicketModal } from "@/components/today/today-ticket-modal";

export const metadata: Metadata = { title: "Plan" };
export const dynamic = "force-dynamic";

/** How far back finished work stays visible on the calendar. */
const HISTORY_DAYS = 120;

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { weekStartsOn, calendarFeeds } = parseUserSettings(ctx.user.settings);
  const boardWhere = boardWhereForContext(ctx);
  const since = addDays(startOfDay(new Date()), -HISTORY_DAYS);

  const [members, boardRows, ticketRows, notes, agents] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: true } }),
    db.board.findMany({
      where: boardWhere,
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        columns: { orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true, stage: true } },
      },
    }),
    // Open tickets (dated or not — undated ones are what the tray plans), plus
    // recently finished dated ones so past days still show what got done.
    db.ticket.findMany({
      where: {
        board: boardWhere,
        deletedAt: null,
        OR: [{ column: { isDone: false } }, { dueDate: { gte: since } }],
      },
      include: ticketRowInclude,
      orderBy: [{ dueDate: "asc" }, { position: "asc" }],
    }),
    listNotesForUser(ctx.user.id),
    db.agent.findMany({
      where: { workspaceId: ctx.workspace.id, status: "active" },
      select: { id: true, name: true, color: true, kind: true, ownerUserId: true, ownerUser: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const usersById = new Map<string, UserLite>(
    members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarUrl: m.user.avatarUrl, avatarColor: m.user.avatarColor }]),
  );
  const boards: PlanBoard[] = boardRows.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    color: b.color,
    columns: b.columns.map((c) => ({ id: c.id, name: c.name, isDone: c.isDone, stage: c.stage })),
  }));
  const doneColumnByBoard = new Map(boardRows.map((b) => [b.id, b.columns.find((c) => c.isDone)?.id ?? null]));
  const tickets = ticketRows.map((t) => toTicketRow(t, usersById, doneColumnByBoard));
  const sinceYmd = ymd(since);
  const tasks = notes.filter((n) => isTaskNote(n) && (n.doneOn == null || n.doneOn >= sinceYmd)).map(toNoteRow);

  const modal = await loadTicketModal(sp.ticket, boardWhere, usersById);

  return (
    <>
      <PlanView
        tasks={tasks}
        tickets={tickets}
        boards={boards}
        feeds={calendarFeeds.map((f) => ({ id: f.id, name: f.name, color: f.color }))}
        weekStartsOn={weekStartsOn}
        initialNow={new Date().toISOString()}
      />
      {modal && (
        <TodayTicketModal
          ticket={modal.ticket}
          columns={modal.columns}
          labels={modal.labels}
          agents={agents.map(({ ownerUser, ...a }) => ({ ...a, ownerName: ownerUser?.name ?? null }))}
          members={modal.members}
          currentUser={{ id: ctx.user.id, name: ctx.user.name }}
          returnTo="/plan"
        />
      )}
    </>
  );
}
