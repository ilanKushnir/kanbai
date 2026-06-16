/**
 * End-to-end webhook verification harness.
 * Stands up a receiver, points Hermes at it, fires a test webhook,
 * and checks that the HMAC signature verifies with the agent's secret.
 *
 * Usage: APP_URL=http://localhost:54669 npx tsx scripts/verify-webhook.ts
 */
import http from "node:http";
import { PrismaClient } from "../src/generated/prisma";
import { verifyWebhook } from "../src/lib/crypto";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const PORT = 4599;
const db = new PrismaClient();

async function main() {
  const agent = await db.agent.findFirst({ where: { kind: "hermes" } });
  if (!agent) throw new Error("No Hermes agent found — run the seed first.");
  const secret = agent.webhookSecret ?? "";
  const original = agent.webhookUrl;

  await db.agent.update({
    where: { id: agent.id },
    data: { webhookUrl: `http://127.0.0.1:${PORT}/hook` },
  });

  const received = new Promise<{ ok: boolean; detail: Record<string, unknown> }>((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const sig = req.headers["x-kanbai-signature"] as string;
        const ts = req.headers["x-kanbai-timestamp"] as string;
        const event = req.headers["x-kanbai-event"] as string;
        const ok = verifyWebhook(secret, ts, body, sig);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ received: true }));
        server.close();
        resolve({
          ok,
          detail: { event, timestamp: ts, signature: sig?.slice(0, 24) + "…", verified: ok, bodyPreview: body.slice(0, 80) },
        });
      });
    });
    server.listen(PORT);
  });

  // Trigger via the app's internal test endpoint.
  const res = await fetch(`${APP_URL}/api/agents/${agent.id}/test`, { method: "POST" });
  console.log(`POST /api/agents/${agent.id}/test → HTTP ${res.status}`);

  const result = await Promise.race([
    received,
    new Promise<{ ok: boolean; detail: Record<string, unknown> }>((_, rej) =>
      setTimeout(() => rej(new Error("timeout waiting for webhook")), 6000),
    ),
  ]);

  console.log("\nWebhook received:");
  console.log(JSON.stringify(result.detail, null, 2));
  console.log(result.ok ? "\n✅ HMAC signature VERIFIED" : "\n❌ signature mismatch");

  await db.agent.update({ where: { id: agent.id }, data: { webhookUrl: original } });
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
