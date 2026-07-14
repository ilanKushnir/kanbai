import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { updateNote } from "@/lib/services/notes";
import { moveTicketToDone } from "@/lib/services/tickets";
import { db } from "@/lib/db";

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The progress file produced by the offline checklist (extra keys ignored). */
const progressSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(["ticket", "note"]),
        id: z.string().min(1).max(64),
        done: z.boolean().optional(),
        doneAt: dayString.optional(),
      }),
    )
    .max(5000),
});

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Apply progress marked offline (via the exported checklist) after downtime:
 * checked tickets move to their board's done column, checked notes get their
 * doneOn stamped with the day they were ticked. Idempotent — items already
 * done are counted, not re-done; unknown ids are skipped with a reason.
 */
export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const { items } = parse(progressSchema, await readJson(req));
  const actor = { type: "user" as const, id: ctx.user.id, name: ctx.user.name };

  let tickets = 0;
  let notes = 0;
  let alreadyDone = 0;
  const skipped: { type: string; id: string; reason: string }[] = [];

  for (const item of items) {
    if (item.done === false) continue;
    try {
      if (item.type === "note") {
        const note = await db.note.findUnique({
          where: { id: item.id },
          select: { userId: true, doneOn: true, deletedAt: true },
        });
        if (!note || note.deletedAt || note.userId !== ctx.user.id) {
          skipped.push({ type: "note", id: item.id, reason: "not found" });
          continue;
        }
        if (note.doneOn) {
          alreadyDone++;
          continue;
        }
        await updateNote(item.id, { doneOn: item.doneAt ?? localDay() });
        notes++;
      } else {
        const ticket = await db.ticket.findUnique({
          where: { id: item.id },
          select: { deletedAt: true, column: { select: { isDone: true } } },
        });
        if (!ticket || ticket.deletedAt) {
          skipped.push({ type: "ticket", id: item.id, reason: "not found" });
          continue;
        }
        await assertTicketAccess(ctx, item.id, true);
        if (ticket.column.isDone) {
          alreadyDone++;
          continue;
        }
        await moveTicketToDone(item.id, actor);
        tickets++;
      }
    } catch (e) {
      skipped.push({
        type: item.type,
        id: item.id,
        reason: e instanceof Error ? e.message : "failed",
      });
    }
  }

  return ok({ tickets, notes, alreadyDone, skipped });
});
