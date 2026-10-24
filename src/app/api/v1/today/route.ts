import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { agentBoardWhere, agentWorkspaceIds } from "@/lib/access";
import { getAgenda } from "@/lib/services/agenda";
import { resolveWorkspaceUserId } from "@/lib/services/notes";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/today[?scope=all|mine]
 *
 * The day's agenda in one call, computed in the workspace timezone (KANBAI_TZ,
 * default Asia/Jerusalem): overdue / today / tomorrow / upcoming tickets, the
 * unscheduled note inbox, today's notes, and what got done today. The "person"
 * is the agent's owner when it has one, else the workspace owner.
 * `scope=mine` narrows tickets to the ones assigned to that person.
 */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "tickets:read");
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";

  const userId = agent.ownerUserId ?? (await resolveWorkspaceUserId(agent.workspaceId, {}));
  const agenda = await getAgenda({
    workspaceId: agent.workspaceId,
    userId,
    boardWhere: await agentBoardWhere(agent),
    peopleWorkspaceIds: await agentWorkspaceIds(agent),
    scope,
  });
  return ok(agenda);
});
