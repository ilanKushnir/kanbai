import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { updateWorkspaceSchema } from "@/lib/validation";
import { db } from "@/lib/db";

/** Update the active workspace's settings (managers; rename is owner-only). */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ workspaceId: string }> }) => {
    const ctx = await getCurrentContext();
    assertManager(ctx);
    const { workspaceId } = await params;
    if (workspaceId !== ctx.workspace.id) throw new HttpError(404, "Workspace not found");

    const input = parse(updateWorkspaceSchema, await readJson(req));
    const data: Record<string, unknown> = {};

    if (input.name !== undefined) {
      if (ctx.role !== "owner") throw new HttpError(403, "Only the owner can rename the workspace.");
      data.name = input.name;
    }
    if (input.snapshotLimit !== undefined) data.snapshotLimit = input.snapshotLimit;
    if (input.defaultAgentId !== undefined) {
      const id = input.defaultAgentId || null;
      if (id) {
        const a = await db.agent.findUnique({ where: { id }, select: { workspaceId: true } });
        if (!a || a.workspaceId !== ctx.workspace.id) throw new HttpError(404, "Agent not found");
      }
      data.defaultAgentId = id;
    }

    if (Object.keys(data).length) await db.workspace.update({ where: { id: ctx.workspace.id }, data });
    return ok({ ok: true });
  },
);
