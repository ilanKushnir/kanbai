import { handler, ok } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { parse, readJson } from "@/lib/parse";
import { registerWebhookV1Schema } from "@/lib/validation";
import { setOwnWebhook } from "@/lib/services/agents";
import { serializeWebhookStatus } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * Agent self-setup for its OWN callback webhook, authenticated by its bearer key.
 *
 *   GET  /api/v1/agent/webhook   → current webhook status (url, active, signed)
 *   POST /api/v1/agent/webhook   → register/update url, active, and optional secret
 *   PUT                          → alias of POST
 *
 * No extra scope is required: an agent is always allowed to manage its own
 * webhook. Signing is optional (recommended) — omit `secret` to leave callbacks
 * unsigned on a trusted/internal listener path.
 */
export const GET = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  return ok({ webhook: serializeWebhookStatus(agent) });
});

export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  const input = parse(registerWebhookV1Schema, await readJson(req));
  const webhook = await setOwnWebhook(agent.id, input);
  return ok({ webhook });
});

export const PUT = POST;
