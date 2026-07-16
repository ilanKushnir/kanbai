import { handler, ok } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { serializeAgentPublic, serializeWebhookStatus } from "@/lib/serialize";
import { RICH_TEXT_TAGS } from "@/lib/sanitize";
import {
  PRIORITIES,
  NOTE_BUCKETS,
  SERVICE_NAME,
  API_VERSION,
  AGENT_CAPABILITIES,
  WEBHOOK_EVENTS,
} from "@/lib/constants";
import { COLUMN_STAGES, STAGE_META } from "@/lib/column-stage";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return ok({
    // App/service identity + API version so agents can adapt without guessing.
    service: { name: SERVICE_NAME, version: APP_VERSION },
    apiVersion: API_VERSION,
    // Preferred base URL for all agent calls (internal/LAN URL when deployed locally).
    baseUrl: baseUrl ? `${baseUrl}/api/${API_VERSION}` : null,
    agent: serializeAgentPublic(agent),
    workspaceId: agent.workspaceId,
    // Effective per-agent permissions.
    scopes: agent.scopes.split(",").filter(Boolean),
    // What the service supports (resources, webhook self-setup, optional signing, events).
    capabilities: { ...AGENT_CAPABILITIES, events: [...WEBHOOK_EVENTS] },
    // Whether this agent's outbound webhook is configured / active / signed.
    webhook: serializeWebhookStatus(agent),
    // Self-describing formats so agents file tickets correctly without guessing.
    conventions: {
      // Ticket `description` is simple HTML, sanitized server-side to this allowlist.
      // Anything outside it is stripped; plain text is also accepted.
      descriptionFormat: "html",
      descriptionAllowedTags: [...RICH_TEXT_TAGS],
      priorities: [...PRIORITIES],
      noteBuckets: [...NOTE_BUCKETS],
      // Semantic column stages: set via PATCH column { stage }. "done" implies
      // isDone (completion counting); the two are kept in lockstep server-side.
      columnStages: COLUMN_STAGES.map((s) => ({ stage: s, label: STAGE_META[s].label, hint: STAGE_META[s].hint })),
    },
  });
});
