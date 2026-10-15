import { handler, ok, HttpError } from "@/lib/api";
import { readJson } from "@/lib/parse";
import { redeemConnectCode } from "@/lib/services/agents";
import { serializeAgentPublic } from "@/lib/serialize";
import { agentBaseUrls } from "@/lib/agent-connect";
import { SERVICE_NAME } from "@/lib/constants";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Redeem a one-time connect code (from the agent brief) for an API key.
 * Unauthenticated by design: the code itself is the credential.
 */
export const POST = handler(async (req: Request) => {
  const body = (await readJson(req)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code) throw new HttpError(400, 'Send {"code":"kbc_…"} from the connect brief.', "missing_code");

  const { agent, apiKey } = await redeemConnectCode(code);
  const urls = agentBaseUrls(req);
  return ok(
    {
      apiKey,
      ...urls,
      service: { name: SERVICE_NAME, version: APP_VERSION },
      agent: serializeAgentPublic(agent),
      storeAs: { apiKey: "KANBAI_API_KEY", baseUrl: "KANBAI_URL" },
      next: [
        "Store apiKey (as KANBAI_API_KEY) and baseUrl (as KANBAI_URL) in your persistent secret store now. Do not echo the key into chat.",
        `Install the skill: ${urls.skillUrl}`,
        "GET {baseUrl}/me with 'Authorization: Bearer <apiKey>' to verify, then tell the owner you're connected.",
      ],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
