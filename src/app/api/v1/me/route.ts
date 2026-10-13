import { handler, ok } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { serializeAgentPublic } from "@/lib/serialize";
import { RICH_TEXT_TAGS } from "@/lib/sanitize";
import { PRIORITIES, NOTE_BUCKETS, SERVICE_NAME, API_VERSION, AGENT_CAPABILITIES } from "@/lib/constants";
import { COLUMN_STAGES, STAGE_META } from "@/lib/column-stage";
import { APP_VERSION } from "@/lib/version";
import { workspaceTz } from "@/lib/tz";
import { buildQuickstart } from "@/lib/quickstart";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const baseUrl = appUrl ? `${appUrl}/api/${API_VERSION}` : null;
  return ok({
    // App/service identity + API version so agents can adapt without guessing.
    service: { name: SERVICE_NAME, version: APP_VERSION },
    apiVersion: API_VERSION,
    // Preferred base URL for all agent calls (internal/LAN URL when deployed locally).
    baseUrl,
    agent: serializeAgentPublic(agent),
    workspaceId: agent.workspaceId,
    // The user this agent acts for (caps board/note access); null = workspace-wide.
    ownerUserId: agent.ownerUserId,
    // Effective per-agent permissions.
    scopes: agent.scopes.split(",").filter(Boolean),
    // What the service supports (pull-only REST; no callbacks).
    capabilities: AGENT_CAPABILITIES,
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
      // dueDate: "YYYY-MM-DD" (→ noon in `timezone`), ISO with offset, or UTC "Z"; null clears.
      dueDateFormats: ["YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss+02:00", "YYYY-MM-DDTHH:mm:ssZ", null],
      // "Today" for /today, due filters and date-only dueDates is computed in this zone.
      timezone: workspaceTz(),
    },
    quickstart: buildQuickstart(baseUrl ?? ""),
  });
});
