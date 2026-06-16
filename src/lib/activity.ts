import { db } from "./db";

type Actor = { type: "user" | "agent" | "system"; id?: string | null; name: string };

export async function logActivity(opts: {
  actor: Actor;
  action: string;
  boardId?: string | null;
  ticketId?: string | null;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.activityLog.create({
      data: {
        boardId: opts.boardId ?? null,
        ticketId: opts.ticketId ?? null,
        actorType: opts.actor.type,
        actorId: opts.actor.id ?? null,
        actorName: opts.actor.name,
        action: opts.action,
        meta: opts.meta ? JSON.stringify(opts.meta) : null,
      },
    });
  } catch (err) {
    console.error("[activity] failed to log", err);
  }
}
