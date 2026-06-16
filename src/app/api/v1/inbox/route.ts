import { handler, ok } from "@/lib/api";
import { requireAgent, requireScope } from "@/lib/agent-auth";
import { listInboxForAgent } from "@/lib/services/notes";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  requireScope(agent, "inbox:read");
  const notes = await listInboxForAgent(agent.id);
  return ok({ notes });
});
