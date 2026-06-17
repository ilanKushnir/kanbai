import { handler, ok } from "@/lib/api";
import { destroyCurrentSession } from "@/lib/auth";

export const POST = handler(async () => {
  await destroyCurrentSession();
  return ok({ ok: true });
});
