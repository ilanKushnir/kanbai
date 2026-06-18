import { handler, ok, created } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { listSnapshots, createSnapshot, markManualAction } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  assertManager(ctx);
  return ok({ snapshots: await listSnapshots(ctx.workspace.id) });
});

/** Manually capture the current board state. */
export const POST = handler(async () => {
  const ctx = await getCurrentContext();
  assertManager(ctx);
  await markManualAction(ctx.workspace.id);
  const snap = await createSnapshot(ctx.workspace.id, { kind: "manual", reason: "Manual snapshot" });
  return created({ id: snap.id });
});
