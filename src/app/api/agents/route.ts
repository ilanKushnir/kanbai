import { handler, ok, created } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createAgentSchema } from "@/lib/validation";
import { createAgent, serializeAgent } from "@/lib/services/agents";
import { db } from "@/lib/db";

export const GET = handler(async () => {
  const { workspace } = await getCurrentContext();
  const agents = await db.agent.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
  });
  return ok({ agents: agents.map(serializeAgent) });
});

export const POST = handler(async (req: Request) => {
  const { workspace } = await getCurrentContext();
  const input = parse(createAgentSchema, await readJson(req));
  const result = await createAgent(workspace.id, input);
  return created(result); // { agent, apiKey } — apiKey shown once
});
