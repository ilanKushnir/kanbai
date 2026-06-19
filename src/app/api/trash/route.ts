import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { trashActionSchema } from "@/lib/validation";
import { listTrash, restoreNote, purgeNote, restoreTicket, purgeTicket } from "@/lib/services/trash";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  return ok(await listTrash(ctx));
});

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const { action, type, id } = parse(trashActionSchema, await readJson(req));
  if (type === "note") {
    if (action === "restore") await restoreNote(ctx, id);
    else await purgeNote(ctx, id);
  } else {
    if (action === "restore") await restoreTicket(ctx, id);
    else await purgeTicket(ctx, id);
  }
  return ok({ ok: true });
});
