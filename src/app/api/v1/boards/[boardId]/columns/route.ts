import { handler, ok, created } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { assertAgentBoardAccess } from "@/lib/access";
import { parse, readJson } from "@/lib/parse";
import { createColumnV1Schema } from "@/lib/validation";
import { parseSubStates } from "@/lib/substates";
import { resolveColumnStage } from "@/lib/column-stage";
import { logActivity } from "@/lib/activity";
import { guardAgentSnapshot } from "@/lib/snapshots";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ boardId: string }> };

function serializeColumn(c: {
  id: string;
  name: string;
  isDone: boolean;
  stage: string | null;
  wipLimit: number | null;
  position: number;
  subStates: string | null;
}) {
  return {
    id: c.id,
    name: c.name,
    isDone: c.isDone,
    stage: resolveColumnStage(c.stage, c.name, c.isDone),
    wipLimit: c.wipLimit,
    position: c.position,
    subStates: parseSubStates(c.subStates),
  };
}

/** List the board's columns in order. */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:read");
  const { boardId } = await params;
  await assertAgentBoardAccess(agent, boardId);
  const columns = await db.column.findMany({ where: { boardId }, orderBy: { position: "asc" } });
  return ok({ columns: columns.map(serializeColumn) });
});

/** Add a column to an existing board (appended at the end). */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const agent = await requireAgent(req);
  requireScope(agent, "boards:write");
  const { boardId } = await params;
  await assertAgentBoardAccess(agent, boardId);
  const input = parse(createColumnV1Schema, await readJson(req));
  await guardAgentSnapshot(agent.workspaceId, { id: agent.id, name: agent.name });

  const count = await db.column.count({ where: { boardId } });
  const column = await db.column.create({
    data: {
      boardId,
      name: input.name,
      // stage "done" and the isDone flag imply each other — keep them in lockstep.
      isDone: input.stage ? input.stage === "done" : input.isDone ?? false,
      stage: input.stage ?? (input.isDone ? "done" : null),
      position: count,
    },
  });
  await logActivity({
    actor: { type: "agent", id: agent.id, name: agent.name },
    action: "column.created",
    boardId,
    meta: { columnId: column.id, name: column.name },
  });
  return created({ column: serializeColumn(column) });
});
