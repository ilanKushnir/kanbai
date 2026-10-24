import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { listNotifications, notificationScope } from "@/lib/services/notifications";

/** GET /api/notifications — the viewer's recent "you were assigned" entries, every workspace. */
export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  return ok({ notifications: await listNotifications(ctx.user.id, notificationScope(ctx)) });
});
