import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentBoardAccess, boardWorkspaceId } from "@/lib/access";
import { boardAssigneeUsers } from "@/lib/services/board-members";
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
    const board = await getBoardWithData(await boardWorkspaceId(boardId), { id: boardId });
    const people = (await boardAssigneeUsers(boardId)).map((u) => ({ id: u.id, name: u.name }));
    return ok({ board: { ...board, people } });
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
    // A board shared from someone else's workspace: tickets yes, the board itself no.
    if ((await boardWorkspaceId(boardId)) !== agent.workspaceId) {
      throw new HttpError(403, "This board is shared from another workspace; only its tickets can be changed.", "shared_board");
    }
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
    // A board shared from someone else's workspace: tickets yes, the board itself no.
    if ((await boardWorkspaceId(boardId)) !== agent.workspaceId) {
      throw new HttpError(403, "This board is shared from another workspace; only its tickets can be changed.", "shared_board");
    }
    await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });
    const board = await updateBoard(boardId, { archived: true }, { type: "agent", id: agent.id, name: agent.name });
    return ok({ ok: true, archived: true, board });
  },
);
