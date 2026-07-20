import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { signWebhook, verifyWebhook, secretFingerprint } from "@/lib/crypto";
import { dispatchWebhook, snippetOf, type DeliveryResult } from "@/lib/webhooks";
import { isSubscribed, eventsToSpec, toggleEventSpec, resolveEventSpec, SELECTABLE_EVENTS } from "@/lib/webhook-events";
import { sendTestWebhook } from "@/lib/services/agents";

// End-to-end coverage for the outbound webhook path: signature generation
// (exact header + HMAC-over-raw-bytes shape the receiver recomputes), the
// awaited "Send test" delivery with the receiver's response captured, terminal
// 401 handling, and per-agent event subscriptions.

const SECRET = "whsec_test_dummy_secret_for_delivery";

type Captured = {
  headers: http.IncomingHttpHeaders;
  rawBody: Buffer;
};

let server: http.Server;
let baseUrl: string;
let captured: Captured | null = null;
// Per-request behavior the tests flip: [statusCode, responseBody]
let respondWith: [number, string] = [200, "ok"];

function assertCaptured(): Captured {
  assert.ok(captured, "receiver captured the request");
  return captured;
}

let wsId: string;
let agentId: string;

async function wipe() {
  await db.webhookDelivery.deleteMany();
  await db.activityLog.deleteMany();
  await db.snapshot.deleteMany();
  await db.subtask.deleteMany();
  await db.ticket.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.note.deleteMany();
  await db.agent.deleteMany();
  await db.boardAccess.deleteMany();
  await db.board.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
}

before(async () => {
  await wipe();
  const ws = await db.workspace.create({ data: { name: "WH WS", slug: "wh-ws" } });
  wsId = ws.id;

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      captured = { headers: req.headers, rawBody: Buffer.concat(chunks) };
      const [status, body] = respondWith;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const agent = await db.agent.create({
    data: {
      workspaceId: wsId,
      name: "Test Receiver",
      kind: "hermes",
      webhookUrl: `${baseUrl}/webhooks/kanbai-astra`,
      webhookSecret: SECRET,
    },
  });
  agentId = agent.id;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await wipe();
});

// ── Signature generation ──

test("signWebhook is hex HMAC-SHA256 over `${timestamp}.${rawBody}`", () => {
  const sig = signWebhook("s3cret-key", "1700000000", '{"a":1}');
  const expected = crypto.createHmac("sha256", "s3cret-key").update('1700000000.{"a":1}').digest("hex");
  assert.equal(sig, expected);
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test("verifyWebhook accepts the reference signature (with and without sha256= prefix) and rejects tampering", () => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = '{"event":"ping"}';
  const sig = signWebhook(SECRET, ts, body);
  assert.equal(verifyWebhook(SECRET, ts, body, `sha256=${sig}`), true);
  assert.equal(verifyWebhook(SECRET, ts, body, sig), true);
  assert.equal(verifyWebhook(SECRET, ts, body + " ", `sha256=${sig}`), false);
  assert.equal(verifyWebhook("other-secret", ts, body, `sha256=${sig}`), false);
});

test("secretFingerprint is the first 8 hex of sha256 and never the secret", () => {
  const fp = secretFingerprint(SECRET);
  assert.equal(fp, crypto.createHash("sha256").update(SECRET).digest("hex").slice(0, 8));
  assert.equal(fp.length, 8);
  assert.ok(!SECRET.includes(fp));
});

// ── Event subscriptions ──

test("isSubscribed: '*' matches everything, lists filter, ping is always on", () => {
  assert.equal(isSubscribed("*", "ticket.created"), true);
  assert.equal(isSubscribed(null, "ticket.created"), true); // legacy rows default to all
  assert.equal(isSubscribed("ticket.created,comment.created", "ticket.created"), true);
  assert.equal(isSubscribed("ticket.created,comment.created", "ticket.moved"), false);
  assert.equal(isSubscribed("", "ticket.created"), false);
  assert.equal(isSubscribed("", "ping"), true);
});

test("eventsToSpec collapses a full selection to '*' and round-trips subsets", () => {
  assert.equal(eventsToSpec(SELECTABLE_EVENTS), "*");
  const subset = eventsToSpec(["ticket.created", "comment.created"]);
  assert.deepEqual(resolveEventSpec(subset), ["ticket.created", "comment.created"]);
  assert.equal(eventsToSpec([]), "");
});

test("toggleEventSpec flips one event and collapses back to '*' when complete", () => {
  const without = toggleEventSpec("*", "ticket.moved");
  assert.equal(isSubscribed(without, "ticket.moved"), false);
  assert.equal(isSubscribed(without, "ticket.created"), true);
  assert.equal(toggleEventSpec(without, "ticket.moved"), "*");
});

// ── snippetOf ──

test("snippetOf flattens control chars, collapses whitespace, and truncates", () => {
  assert.equal(snippetOf('{"error":\n\t"invalid signature"}'), '{"error": "invalid signature"}');
  assert.equal(snippetOf("x".repeat(500)).length, 300);
});

// ── Awaited delivery over a real HTTP server ──

test("a signed delivery carries the exact headers and an HMAC the receiver can verify from raw bytes", async () => {
  respondWith = [200, '{"ok":true}'];
  captured = null;

  const result = (await dispatchWebhook(agentId, "ping", { message: "hi" }, { wait: true })) as DeliveryResult;

  assert.equal(result.status, "success");
  assert.equal(result.statusCode, 200);
  assert.equal(result.signed, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.error, null);

  const request = assertCaptured();
  const h = request.headers;
  assert.equal(h["content-type"], "application/json");
  assert.equal(h["x-kanbai-event"], "ping");
  assert.equal(h["x-kanbai-delivery"], result.deliveryId);
  assert.match(String(h["x-kanbai-timestamp"]), /^\d{10}$/); // unix seconds
  assert.match(String(h["x-kanbai-signature"]), /^sha256=[0-9a-f]{64}$/);

  // Recompute the HMAC exactly as Hermes does: secret over `${ts}.${rawBody}`
  // using the raw request bytes, not re-serialized JSON.
  const ts = String(h["x-kanbai-timestamp"]);
  const raw = request.rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  assert.equal(h["x-kanbai-signature"], `sha256=${expected}`);
  assert.equal(verifyWebhook(SECRET, ts, raw, String(h["x-kanbai-signature"])), true);

  // The payload envelope is intact JSON with the event + workspace.
  const payload = JSON.parse(raw);
  assert.equal(payload.event, "ping");
  assert.equal(payload.workspaceId, wsId);

  const row = await db.webhookDelivery.findUnique({ where: { id: result.deliveryId } });
  assert.equal(row?.status, "success");
  assert.equal(row?.statusCode, 200);
});

test("a 401 is terminal: one attempt, no retry, and the receiver's error body is captured", async () => {
  respondWith = [401, '{"error":"invalid signature"}'];

  const result = (await dispatchWebhook(agentId, "ping", { message: "hi" }, { wait: true })) as DeliveryResult;

  assert.equal(result.status, "failed");
  assert.equal(result.statusCode, 401);
  assert.equal(result.attempts, 1); // terminal — never retried
  assert.match(result.error ?? "", /HTTP 401/);
  assert.match(result.error ?? "", /invalid signature/); // the receiver's own words
  assert.match(result.error ?? "", /not retried/);

  const row = await db.webhookDelivery.findUnique({ where: { id: result.deliveryId } });
  assert.equal(row?.status, "failed");
  assert.match(row?.error ?? "", /invalid signature/);
});

test("sendTestWebhook waits for the outcome and reports the signing fingerprint", async () => {
  respondWith = [200, '{"ok":true}'];
  const { result, secretFingerprint: fp } = await sendTestWebhook(agentId);
  assert.equal(result.status, "success");
  assert.equal(fp, secretFingerprint(SECRET));
});

test("sendTestWebhook fails fast with a clear message when the webhook is paused", async () => {
  await db.agent.update({ where: { id: agentId }, data: { webhookActive: false } });
  await assert.rejects(
    () => sendTestWebhook(agentId),
    (e: unknown) => e instanceof HttpError && /paused/.test(e.message),
  );
  await db.agent.update({ where: { id: agentId }, data: { webhookActive: true } });
});

test("an agent subscribed to a subset is skipped for other events but still receives ping", async () => {
  await db.agent.update({ where: { id: agentId }, data: { webhookEvents: "comment.created" } });

  const skipped = await dispatchWebhook(agentId, "ticket.created", {}, { wait: true });
  assert.equal(skipped, undefined); // filtered out — no delivery row created

  respondWith = [200, "ok"];
  const ping = (await dispatchWebhook(agentId, "ping", {}, { wait: true })) as DeliveryResult;
  assert.equal(ping.status, "success");

  await db.agent.update({ where: { id: agentId }, data: { webhookEvents: "*" } });
});
