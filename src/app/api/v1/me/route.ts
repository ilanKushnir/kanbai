import { handler, ok } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { serializeAgentPublic } from "@/lib/serialize";
import { RICH_TEXT_TAGS } from "@/lib/sanitize";
import { PRIORITIES, NOTE_BUCKETS, SERVICE_NAME, API_VERSION, AGENT_CAPABILITIES } from "@/lib/constants";
import { COLUMN_STAGES, STAGE_META } from "@/lib/column-stage";
import { APP_VERSION } from "@/lib/version";
import { workspaceTz } from "@/lib/tz";
import { buildQuickstart } from "@/lib/quickstart";
import { agentBaseUrls } from "@/lib/agent-connect";
import { agentPersonId } from "@/lib/access";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  const urls = agentBaseUrls(req);
  const baseUrl = urls.baseUrl || null;
  const personId = await agentPersonId(agent);
  const person = personId ? await db.user.findUnique({ where: { id: personId }, select: { id: true, name: true } }) : null;
  return ok({
    // App/service identity + API version so agents can adapt without guessing.
    service: { name: SERVICE_NAME, version: APP_VERSION },
    apiVersion: API_VERSION,
    // Preferred base URL for all agent calls (internal/LAN URL when deployed locally).
    baseUrl,
    publicBaseUrl: urls.publicBaseUrl || null,
    // The installable skill (SKILL.md) — re-fetch when service.version changes.
    skillUrl: urls.skillUrl || null,
    agent: serializeAgentPublic(agent),
    workspaceId: agent.workspaceId,
    // The user this agent is assigned to (caps board/note access); null = workspace-wide.
    ownerUserId: agent.ownerUserId,
    // Whose access it uses for boards shared from other workspaces: the owner,
    // or the workspace's owner when it has none.
    actsFor: person,
    // Effective per-agent permissions.
    scopes: agent.scopes.split(",").filter(Boolean),
    // What the service supports (pull-only REST; no callbacks).
    capabilities: AGENT_CAPABILITIES,
    // Self-describing formats so agents file tickets correctly without guessing.
    conventions: {
      // Ticket `description` is Markdown (GFM), stored and returned as-is. Simple HTML
      // is still accepted — sanitized server-side to descriptionAllowedTags.
      descriptionFormat: "markdown",
      descriptionFormats: ["markdown", "html"],
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
