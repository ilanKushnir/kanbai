import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { updateBoardV1Schema } from "@/lib/validation";
import { getBoardWithData, updateBoard } from "@/lib/services/boards";
import { guardAgentSnapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "boards:read");
    const { boardId } = await params;
    await assertAgentBoardAccess(agent, boardId);
    const board = await getBoardWithData(agent.workspaceId, { id: boardId });
    return ok({ board });
  },
);

/**
 * Update board metadata, or archive/unarchive it. Archiving is the agent-safe
 * "delete" for boards: fully reversible (`archived: false` brings it back with
 * every ticket intact). Permanently destroying a board stays human-only.
 */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "boards:write");
    const { boardId } = await params;
    await assertAgentBoardAccess(agent, boardId);
    const input = parse(updateBoardV1Schema, await readJson(req));
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });
    const board = await updateBoard(boardId, input, { type: "agent", id: agent.id, name: agent.name });
    return ok({ board });
  },
);

/**
 * DELETE archives (soft). Same as PATCH { archived: true } — nothing is
 * destroyed; `PATCH { archived: false }` restores the board with all tickets.
 */
export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ boardId: string }> }) => {
    const agent = await requireAgent(req);
    requireScope(agent, "boards:write");
    const { boardId } = await params;
    await assertAgentBoardAccess(agent, boardId);
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });
    const board = await updateBoard(boardId, { archived: true }, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ok: true, archived: true, board });
  },
);
