import { db } from "./db";
import { signWebhook, randomId } from "./crypto";
import type { WebhookEvent } from "./constants";

/**
 * Deliver a signed event to one agent's webhook.
 *
 * Headers the agent should verify:
 *   X-Kanbai-Event       the event name
 *   X-Kanbai-Timestamp   unix seconds (used in the signed string + replay window)
 *   X-Kanbai-Signature   "sha256=<hex HMAC of `${timestamp}.${rawBody}`>"
 *   X-Kanbai-Delivery    delivery id (idempotency key)
 */
export async function dispatchWebhook(agentId: string, event: WebhookEvent, data: unknown) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || !agent.webhookUrl || !agent.webhookActive || agent.status !== "active") return;

  const secret = agent.webhookSecret ?? "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: randomId("evt"),
    event,
    created: new Date().toISOString(),
    workspaceId: agent.workspaceId,
    data,
  });
  const signature = signWebhook(secret, timestamp, body);

  const delivery = await db.webhookDelivery.create({
    data: { agentId: agent.id, event, payload: body, signature, status: "pending" },
  });

  void deliver(agent.webhookUrl, body, event, timestamp, signature, delivery.id);
  return delivery.id;
}

async function deliver(
  url: string,
  body: string,
  event: string,
  timestamp: string,
  signature: string,
  deliveryId: string,
  maxAttempts = 3,
) {
  let attempt = 0;
  let lastErr: string | undefined;
  let statusCode: number | undefined;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Kanbai-Webhook/1.0",
          "X-Kanbai-Event": event,
          "X-Kanbai-Timestamp": timestamp,
          "X-Kanbai-Signature": `sha256=${signature}`,
          "X-Kanbai-Delivery": deliveryId,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      statusCode = res.status;
      if (res.ok) {
        await db.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: "success", statusCode, attempts: attempt, error: null },
        });
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    // simple linear backoff
    if (attempt < maxAttempts) await sleep(400 * attempt);
  }

  await db.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: "failed", statusCode, attempts: attempt, error: lastErr ?? "delivery failed" },
  });
}

/** Fan out an event to every active subscriber in a workspace. */
export async function broadcast(workspaceId: string, event: WebhookEvent, data: unknown) {
  const agents = await db.agent.findMany({
    where: { workspaceId, status: "active", webhookActive: true, NOT: { webhookUrl: null } },
    select: { id: true },
  });
  await Promise.all(agents.map((a) => dispatchWebhook(a.id, event, data)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
