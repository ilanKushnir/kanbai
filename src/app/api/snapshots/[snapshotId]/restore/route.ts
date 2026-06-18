import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { restoreSnapshot } from "@/lib/snapshots";

export const POST = handler(
  async (_req: Request, { params }: { params: Promise<{ snapshotId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { snapshotId } = await params;
    await restoreSnapshot(snapshotId, ctx.workspace.id);
    return ok({ ok: true });
  },
);
