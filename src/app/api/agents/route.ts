import { handler, ok, created } from "@/lib/api";
import { getCurrentContext, assertManager } from "@/lib/auth";
import { parse, readJson } from "@/lib/parse";
import { createAgentSchema } from "@/lib/validation";
import { createAgent, serializeAgent } from "@/lib/services/agents";
import { db } from "@/lib/db";

export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  const agents = await db.agent.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "asc" },
  });
  return ok({ agents: agents.map(serializeAgent) });
});

export const POST = handler(async (req: Request) => {
  const ctx = await getCurrentContext();
  assertManager(ctx);
  const input = parse(createAgentSchema, await readJson(req));
  const result = await createAgent(ctx.workspace.id, input);
  return created(result);
});
