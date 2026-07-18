import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { reorderColumnsV1Schema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { guardAgentSnapshot } from "@/lib/snapshots";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Reorder the board's columns: `orderedIds` must list every column exactly once. */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "boards:write");
    const { boardId } = await params;
    await assertAgentBoardAccess(agent, boardId);
    const { orderedIds } = parse(reorderColumnsV1Schema, await readJson(req));

    const cols = await db.column.findMany({ where: { boardId }, select: { id: true } });
    const valid = new Set(cols.map((c) => c.id));
    if (orderedIds.length !== cols.length || orderedIds.some((id) => !valid.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
      throw new HttpError(422, "orderedIds must contain every column of this board exactly once.");
    }
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });
    await db.$transaction(orderedIds.map((id, i) => db.column.update({ where: { id }, data: { position: i } })));
    await logActivity({
      actor: { type: "agent", id: agent.id, name: agent.name },
      action: "columns.reordered",
      boardId,
    });
    return ok({ ok: true });
  },
);
