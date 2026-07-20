import { handler, ok, HttpError } from "@/lib/api";
import { requireAgent } from "@/lib/agent-auth";
import { sendTestWebhook } from "@/lib/services/agents";

export const dynamic = "force-dynamic";

/**
 * Agent self-test: fire a `ping` to the agent's own registered webhook URL so it
 * can confirm reachability (and signature verification, if a secret is set)
 * end-to-end with just its bearer key. Waits for the delivery and returns its
 * outcome plus the fingerprint of the signing secret (never the secret itself)
 * so the agent can spot a secret mismatch without another roundtrip.
 */
export const POST = handler(async (req: Request) => {
  const agent = await requireAgent(req);
  if (!agent.webhookUrl) {
    throw new HttpError(422, "Register a webhook URL first (POST /api/v1/agent/webhook).", "no_webhook");
  }
  const { result, secretFingerprint } = await sendTestWebhook(agent.id);
  return ok({ deliveryId: result.deliveryId, result, secretFingerprint });
});
