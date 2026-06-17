import { handler, ok, HttpError } from "@/lib/api";
import { requireApiSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) => {
    await requireApiSystemAdmin();
    const { workspaceId } = await params;
    const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!ws) throw new HttpError(404, "Workspace not found");
    await db.workspace.delete({ where: { id: workspaceId } }); // cascades boards/tickets/agents/etc.
    return ok({ ok: true });
  },
);
