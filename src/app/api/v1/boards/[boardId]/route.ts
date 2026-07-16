import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertBoardInWorkspace } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateBoardV1Schema } from "@/lib/validation";
import { getBoardWithData } from "@/lib/services/boards";
import { logActivity } from "@/lib/activity";
import { guardAgentSnapshot } from "@/lib/snapshots";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "boards:read");
    const { boardId } = await params;
    const board = await getBoardWithData(agent.workspaceId, { id: boardId });
    return ok({ board });
  },
);

/**
 * Update board metadata, or archive/unarchive it. Archiving is the agent-safe
 * "delete" for boards: fully reversible (`archived: false` brings it back with
 * every ticket intact). There is deliberately no board DELETE for agents —
 * destroying a board for good stays human-only.
 */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "boards:write");
    const { boardId } = await params;
    await assertBoardInWorkspace(boardId, agent.workspaceId);
    const input = parse(updateBoardV1Schema, await readJson(req));
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });

    const board = await db.board.update({
      where: { id: boardId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
      },
      select: { id: true, name: true, slug: true, description: true, color: true, archived: true },
    });
    await logActivity({
      actor: { type: "agent", id: agent.id, name: agent.name },
      action:
        input.archived === true ? "board.archived" : input.archived === false ? "board.unarchived" : "board.updated",
      boardId,
      meta: { fields: Object.keys(input) },
    });
    return ok({ board });
  },
);
