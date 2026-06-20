/**
 * Pure-logic checks for the webhook stabilization — no DB, no network.
 * Exercises the retry classifier, the fan-out self-echo filter, the dueDate
 * contract, and the raw-body HMAC sign/verify roundtrip.
 *
 * Usage: npx tsx scripts/check-webhook-policy.ts
 */
import { isRetryableStatus, shouldDeliver } from "../src/lib/webhooks";
import { dueDateSchema } from "../src/lib/validation";
import { signWebhook, verifyWebhook } from "../src/lib/crypto";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

// ── 1. Retry policy: terminal 4xx are NOT retried; 429/5xx ARE ──
for (const s of [400, 401, 403, 404, 409, 422]) {
  check(`HTTP ${s} is terminal (not retried)`, isRetryableStatus(s) === false);
}
for (const s of [429, 500, 502, 503, 504]) {
  check(`HTTP ${s} is retryable`, isRetryableStatus(s) === true);
}

// ── 2. Fan-out filter: an agent never receives an echo of its own event ──
check(
  "agent does not receive its own actor event",
  shouldDeliver("agt_1", "ticket.created", { actor: { type: "agent", id: "agt_1" } }) === false,
);
check(
  "agent receives another agent's event",
  shouldDeliver("agt_1", "ticket.created", { actor: { type: "agent", id: "agt_2" } }) === true,
);
check(
  "agent receives a human-triggered event",
  shouldDeliver("agt_1", "ticket.created", { actor: { type: "user", id: "agt_1" } }) === true,
);
check(
  "no actor → delivered",
  shouldDeliver("agt_1", "ticket.created") === true,
);

// ── 3. dueDate contract: accept date-only / Z / offset; reject ambiguous ──
const accept = ["2026-06-20", "2026-06-20T17:00:00.000Z", "2026-06-20T17:00:00Z", "2026-06-20T17:00:00+02:00"];
const reject = ["2026-06-20T17:00:00", "garbage", "2026-13-40", "20/06/2026"];
for (const v of accept) check(`dueDate accepts ${JSON.stringify(v)}`, dueDateSchema.safeParse(v).success === true);
for (const v of reject) check(`dueDate rejects ${JSON.stringify(v)}`, dueDateSchema.safeParse(v).success === false);
// normalization to a stable instant
check("date-only normalizes to UTC midnight", new Date("2026-06-20").toISOString() === "2026-06-20T00:00:00.000Z");
check(
  "offset normalizes to the equivalent UTC instant",
  new Date("2026-06-20T17:00:00+02:00").toISOString() === "2026-06-20T15:00:00.000Z",
);

// ── 4. Raw-body HMAC roundtrip + tamper + replay ──
const secret = "whsec_test_secret";
const ts = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ event: "ping", data: { hello: "world" } });
const sig = signWebhook(secret, ts, body);
check("valid signature verifies", verifyWebhook(secret, ts, body, `sha256=${sig}`) === true);
check("tampered body fails", verifyWebhook(secret, ts, body + " ", `sha256=${sig}`) === false);
check("wrong secret fails", verifyWebhook("nope", ts, body, `sha256=${sig}`) === false);
check(
  "re-serialized body (key reorder) fails — raw body is required",
  verifyWebhook(secret, ts, JSON.stringify({ data: { hello: "world" }, event: "ping" }), `sha256=${sig}`) === false,
);
const oldTs = (Math.floor(Date.now() / 1000) - 600).toString();
check("stale timestamp fails (replay window)", verifyWebhook(secret, oldTs, body, `sha256=${signWebhook(secret, oldTs, body)}`) === false);

console.log(failures === 0 ? "\n✅ all checks passed" : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
