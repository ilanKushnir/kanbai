import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { assertTicketAccess } from "@/lib/authz";
import { parse, readJson } from "@/lib/parse";
import { checklistProgressSchema } from "@/lib/checklist-progress";
import { updateNote, createNote } from "@/lib/services/notes";
import { moveTicketToDone } from "@/lib/services/tickets";
import { db } from "@/lib/db";

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Apply progress marked offline (via the exported checklist) after downtime:
 * checked tickets move to their board's done column, checked notes get their
 * doneOn stamped with the day they were ticked, and `extras` — local-only
 * tasks added inside the checklist file — come in as fresh notes (done ones
 * arrive already completed). Idempotent — items already done are counted, not
 * re-done; an extra whose exact text already exists as one of your notes is
 * skipped rather than duplicated; unknown ids are skipped with a reason.
 */
export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const { items, extras } = parse(checklistProgressSchema, await readJson(req));
  const actor = { type: "user" as const, id: ctx.user.id, name: ctx.user.name };

  let tickets = 0;
  let notes = 0;
  let alreadyDone = 0;
  let extrasCreated = 0;
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

  // Local-only tasks added in the checklist file become real notes. Re-importing
  // the same progress file must not multiply them, so an extra whose exact text
  // already exists among the user's notes (any status, incl. trashed) is skipped.
  const seenTexts = new Set<string>();
  for (const extra of extras) {
    const text = extra.text.trim();
    const dedupeKey = text.toLowerCase();
    if (!text || seenTexts.has(dedupeKey)) continue;
    seenTexts.add(dedupeKey);
    try {
      const existing = await db.note.findFirst({
        where: { userId: ctx.user.id, body: text },
        select: { id: true },
      });
      if (existing) {
        alreadyDone++;
        continue;
      }
      const note = await createNote(ctx.user.id, text, { scheduledDay: null });
      if (extra.done) await updateNote(note.id, { doneOn: extra.doneAt ?? localDay() });
      extrasCreated++;
    } catch (e) {
      skipped.push({
        type: "extra",
        id: extra.id ?? text.slice(0, 40),
        reason: e instanceof Error ? e.message : "failed",
      });
    }
  }

  return ok({ tickets, notes, alreadyDone, extrasCreated, skipped });
});
