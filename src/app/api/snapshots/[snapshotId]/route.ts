import { handler, ok } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { deleteSnapshot } from "@/lib/snapshots";

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ snapshotId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { snapshotId } = await params;
    await deleteSnapshot(snapshotId, ctx.workspace.id);
    return ok({ ok: true });
  },
);
