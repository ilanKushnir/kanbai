import { readFile } from "node:fs/promises";
import path from "node:path";
import { agentBaseUrls, buildSkill } from "@/lib/agent-connect";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** The agent skill (SKILL.md): setup for this instance + the full protocol. Public — it holds no secrets. */
export async function GET(req: Request) {
  const protocol = await readFile(path.join(process.cwd(), "docs", "AGENT_PROTOCOL.md"), "utf8").catch(() => "");
  const { baseUrl, publicBaseUrl } = agentBaseUrls(req);
  const md = buildSkill({ baseUrl, publicBaseUrl, version: APP_VERSION, protocol });
  return new Response(md, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
