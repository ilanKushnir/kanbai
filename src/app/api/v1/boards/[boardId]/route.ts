import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { getBoardWithData } from "@/lib/services/boards";

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
