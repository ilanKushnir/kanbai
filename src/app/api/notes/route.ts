import { handler, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createNoteSchema } from "@/lib/validation";
import { createNote } from "@/lib/services/notes";

export const POST = handler(async (req: Request) => {
  const { user } = await getCurrentContext();
  const { body, scheduledDay, bucket, priority } = parse(createNoteSchema, await readJson(req));
  const note = await createNote(user!.id, body, { scheduledDay, bucket, priority });
  return created({ note });
});
