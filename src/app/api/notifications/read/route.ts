import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { markNotificationsReadSchema } from "@/lib/validation";
import { markNotificationsRead } from "@/lib/services/notifications";

/** POST /api/notifications/read { ids? } — mark those (or, with no ids, all) as seen. */
export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  const { ids } = parse(markNotificationsReadSchema, await readJson(req));
  const count = await markNotificationsRead(ctx.user.id, ids);
  return ok({ count });
});
