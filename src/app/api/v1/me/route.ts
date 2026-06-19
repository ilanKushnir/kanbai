import { handler, ok } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { serializeAgentPublic } from "@/lib/serialize";
import { RICH_TEXT_TAGS } from "@/lib/sanitize";
import { PRIORITIES, NOTE_BUCKETS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  return ok({
    agent: serializeAgentPublic(agent),
    workspaceId: agent.workspaceId,
    scopes: agent.scopes.split(",").filter(Boolean),
    // Self-describing formats so agents file tickets correctly without guessing.
    conventions: {
      // Ticket `description` is simple HTML, sanitized server-side to this allowlist.
      // Anything outside it is stripped; plain text is also accepted.
      descriptionFormat: "html",
      descriptionAllowedTags: [...RICH_TEXT_TAGS],
      priorities: [...PRIORITIES],
      noteBuckets: [...NOTE_BUCKETS],
    },
  });
});
