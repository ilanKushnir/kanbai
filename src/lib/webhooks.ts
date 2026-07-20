import { db } from "./db";
import { signWebhook, randomId } from "./crypto";
import { isSubscribed } from "./webhook-events";
import type { WebhookEvent } from "./constants";

export { isSubscribed };

/** Who triggered the event — used to avoid echoing an agent's own actions back to it. */
export type WebhookActor = { type: "user" | "agent" | "system"; id?: string | null; name?: string };

export type DispatchOptions = {
  /**
   * The actor that caused the event. An agent is never sent an event it caused
   * itself (its own actor/source events), so it doesn't churn on its own writes.
   */
  actor?: WebhookActor | null;
  /**
   * Await the delivery and get its final outcome (used by "Send test" so the
   * UI can show the receiver's actual response). Normal event fan-out stays
   * fire-and-forget.
   */
  wait?: boolean;
};

/** Final outcome of one delivery — what "Send test" reports back to the UI. */
export type DeliveryResult = {
  deliveryId: string;
  status: "success" | "failed";
  statusCode?: number;
  error: string | null;
  attempts: number;
  signed: boolean;
  durationMs: number;
};

/**
 * Centralized fan-out filter. Generic for any agent — not hard-coded to a
 * specific one. Decides whether `agentId` should receive `event`.
 *
 * Rules today:
 *   • Never deliver an event back to the agent that caused it (no self-echo).
 *
 * Per-agent event subscriptions are applied separately (see {@link isSubscribed})
 * where the agent record is in hand.
 */
export function shouldDeliver(agentId: string, _event: WebhookEvent, opts?: DispatchOptions): boolean {
  const actor = opts?.actor;
  if (actor && actor.type === "agent" && actor.id === agentId) return false;
  return true;
}

/**
 * Which HTTP responses are worth retrying. Terminal 4xx (e.g. 400/401/403/404/
 * 422 — bad request, auth, not-found, validation) will never succeed on replay,
 * so we stop immediately and don't waste the retry budget. Only transient
 * failures are retried: 429 (rate limited) and any 5xx. Network errors and
 * timeouts produce no status code and are retried separately.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Trim a receiver's error response down to something storable/showable. The
 * body usually says WHY a delivery was rejected ("invalid signature", "stale
 * timestamp"), which is exactly what the user needs to debug a 401.
 * Control characters are flattened to spaces so log lines stay single-line.
 */
export function snippetOf(text: string, max = 300): string {
  const printable = Array.from(text, (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? " " : ch;
  }).join("");
  return printable.replace(/ {2,}/g, " ").trim().slice(0, max);
}

/**
 * Deliver an event to one agent's webhook.
 *
 * Signing is OPTIONAL but recommended. If the agent has a signing secret,
 * every payload is HMAC-signed so the receiver can prove authenticity; if not,
 * the callback is still delivered (relying on a trusted/internal listener path)
 * and simply carries no signature header.
 *
 * Headers the agent receives:
 *   X-Kanbai-Event       the event name
 *   X-Kanbai-Timestamp   unix seconds (used in the signed string + replay window)
 *   X-Kanbai-Signature   "sha256=<hex HMAC of `${timestamp}.${rawBody}`>" — only when signed
 *   X-Kanbai-Delivery    delivery id (idempotency key)
 */
export async function dispatchWebhook(
  agentId: string,
  event: WebhookEvent,
  data: unknown,
  opts?: DispatchOptions,
): Promise<DeliveryResult | string | undefined> {
  if (!shouldDeliver(agentId, event, opts)) return;

  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent || !agent.webhookUrl || !agent.webhookActive || agent.status !== "active") return;
  if (!isSubscribed(agent.webhookEvents, event)) return;

  // Signing is optional. With a secret we HMAC the payload; without one we send
  // it unsigned (never sign with an empty key — an HMAC keyed with "" proves
  // nothing and would be trivially forgeable, so we omit the header entirely).
  const secret = agent.webhookSecret ?? "";
  const signed = secret.length > 0;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: randomId("evt"),
    event,
    created: new Date().toISOString(),
    workspaceId: agent.workspaceId,
    data,
  });
  const signature = signed ? signWebhook(secret, timestamp, body) : "";

  const delivery = await db.webhookDelivery.create({
    data: { agentId: agent.id, event, payload: body, signature, status: "pending" },
  });

  if (opts?.wait) {
    return deliver(agent.webhookUrl, body, event, timestamp, signature, delivery.id, signed);
  }
  void deliver(agent.webhookUrl, body, event, timestamp, signature, delivery.id, signed);
  return delivery.id;
}

async function deliver(
  url: string,
  body: string,
  event: string,
  timestamp: string,
  signature: string,
  deliveryId: string,
  signed: boolean,
  maxAttempts = 3,
): Promise<DeliveryResult> {
  const started = Date.now();
  let attempt = 0;
  let lastErr: string | undefined;
  let statusCode: number | undefined;

  const finish = async (status: "success" | "failed", error: string | null): Promise<DeliveryResult> => {
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status, statusCode: statusCode ?? null, attempts: attempt, error },
    });
    return { deliveryId, status, statusCode, error, attempts: attempt, signed, durationMs: Date.now() - started };
  };

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
          // Signature header only when a secret is configured; unsigned callbacks omit it.
          ...(signed ? { "X-Kanbai-Signature": `sha256=${signature}` } : {}),
          "X-Kanbai-Delivery": deliveryId,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      statusCode = res.status;
      if (res.ok) {
        return finish("success", null);
      }
      // The receiver's own words are the best diagnostic — keep a short snippet.
      const responseText = snippetOf(await res.text().catch(() => ""));
      lastErr = responseText ? `HTTP ${res.status} — ${responseText}` : `HTTP ${res.status}`;
      // Terminal 4xx (bad request, auth, not-found, validation) won't recover on
      // replay — fail fast instead of burning the retry budget.
      if (!isRetryableStatus(res.status)) {
        return finish("failed", `${lastErr} · not retried (terminal response)`);
      }
    } catch (err) {
      // Network error / timeout — no status code, transient, so keep retrying.
      lastErr = err instanceof Error ? err.message : String(err);
    }
    // simple linear backoff
    if (attempt < maxAttempts) await sleep(400 * attempt);
  }

  return finish("failed", lastErr ?? "delivery failed");
}

/**
 * Fan out an event to every active subscriber in a workspace, minus the agent
 * that triggered it (see {@link shouldDeliver}). Pass `opts.actor` so an agent's
 * own writes aren't echoed back to it.
 */
export async function broadcast(
  workspaceId: string,
  event: WebhookEvent,
  data: unknown,
  opts?: DispatchOptions,
) {
  const agents = await db.agent.findMany({
    where: { workspaceId, status: "active", webhookActive: true, NOT: { webhookUrl: null } },
    select: { id: true },
  });
  await Promise.all(
    agents
      .filter((a) => shouldDeliver(a.id, event, opts))
      .map((a) => dispatchWebhook(a.id, event, data, opts)),
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
