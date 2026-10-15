// Agent onboarding: the connect brief (pasted into the agent's chat), the URLs
// agents should use, and the hosted SKILL.md. Pure functions — the brief is
// rendered client-side, the skill and URLs server-side.

import { API_VERSION } from "./constants";

/** Public origin of the app (what a browser uses), without a trailing slash. */
export function publicOrigin(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (env) return env;
  if (!req) return "";
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

/**
 * Base URLs for agent calls. `KANBAI_AGENT_URL` (optional) is a direct/LAN
 * origin for agents running next to Kanbai — it skips CDN bot filters (e.g.
 * Cloudflare rejecting non-browser clients with "error 1010") and the tunnel hop.
 */
export function agentBaseUrls(req?: Request) {
  const pub = publicOrigin(req);
  const direct = process.env.KANBAI_AGENT_URL?.replace(/\/+$/, "") || "";
  const publicBaseUrl = pub ? `${pub}/api/${API_VERSION}` : "";
  return {
    baseUrl: direct ? `${direct}/api/${API_VERSION}` : publicBaseUrl,
    publicBaseUrl,
    skillUrl: pub ? `${pub}/api/${API_VERSION}/skill.md` : "",
  };
}

/** A friendly UA that CDN bot filters accept; agents are told to send it. */
export const AGENT_USER_AGENT = "Mozilla/5.0 (compatible; KanbaiAgent/1.0)";

/**
 * The connect brief. It carries a one-time connect code — never the API key —
 * so it is safe in any chat: the agent redeems the code over HTTPS and gets
 * its key straight from Kanbai.
 */
export function buildConnectBrief({
  name,
  code,
  origin,
  expiresAt,
}: {
  name: string;
  code: string;
  origin: string;
  expiresAt: string;
}) {
  const o = origin || "https://your-kanbai.app";
  const base = `${o}/api/${API_VERSION}`;
  const skill = `${base}/skill.md`;
  const expires = new Date(expiresAt).toISOString().replace(/\.\d+Z$/, "Z");
  return `# Connect to Kanbai — ${name}

The owner of this Kanbai workspace is connecting you, "${name}", as their agent.
Kanbai is their task manager (a Today list, project boards, tickets); you drive it
over plain REST. The owner approved everything below — just do it, no need to ask.

This message holds a ONE-TIME CONNECT CODE, not an API key, so it is fine that it
went through chat. Redeeming it mints your API key and hands it to you directly.
The code dies after use (a retry within 10 minutes still works) or at ${expires}.

Connect code: ${code}

## Steps
1. Redeem the code:
   POST ${base}/connect   {"code":"${code}"}
   → { apiKey, baseUrl, publicBaseUrl, skillUrl, agent, … }

   curl -fsS -X POST ${base}/connect \\
     -H 'content-type: application/json' -H 'user-agent: ${AGENT_USER_AGENT}' \\
     -d '{"code":"${code}"}'

2. Keep the result in your persistent secret store or environment, written
   straight from the response (don't repeat the key back in chat):
     KANBAI_API_KEY = apiKey     KANBAI_URL = baseUrl
   It is a scoped integration key the owner issued for you and can revoke any
   time from Kanbai → Agents. Storing it is the intended setup.

3. Install the Kanbai skill — the full API, always current for this version:
   ${skill}
   Hermes: hermes skills install ${skill}
   Claude Code / Codex: save it as skills/kanbai/SKILL.md
   Replacing an older Kanbai skill? Keep only the owner's own rules from it
   (e.g. boards you must not touch); webhooks no longer exist.

4. Verify: GET {baseUrl}/me with  Authorization: Bearer <apiKey>
   Then tell the owner in one line that you're connected.

## If something fails
- 401 invalid_code / code_expired → ask the owner for a fresh brief (Agents → ${name} → Connect).
- 403 "error code: 1010" → a CDN bot filter: send the user-agent header above, or use baseUrl.
- Redeeming twice mints a new key each time — keep the last one.`;
}

/**
 * The hosted SKILL.md (agentskills.io format: YAML frontmatter + Markdown).
 * `protocol` is docs/AGENT_PROTOCOL.md; the header adds setup for this instance.
 */
export function buildSkill({
  baseUrl,
  publicBaseUrl,
  version,
  protocol,
}: {
  baseUrl: string;
  publicBaseUrl: string;
  version: string;
  protocol: string;
}) {
  const base = baseUrl || "http://localhost:3000/api/v1";
  const body = protocol
    .replace(/^# Kanbai Agent Protocol\s*/, "")
    .replace(/`http:\/\/<kanbai-host>:3000\/api\/v1`/g, `\`${base}\``);
  return `---
name: kanbai
description: Manage the owner's tasks, daily Today list and project boards in Kanbai over its REST API — read the day's agenda, add tasks and notes, move and complete tickets, create project boards. Use whenever the owner talks about tasks, to-dos, their day, reminders to do something, projects or boards.
version: ${version}
---

# Kanbai

Kanbai (v${version}) is the owner's single source of truth for tasks. You talk to it
over REST with a bearer key; nothing is pushed to you.

## Setup (once)
- Base URL: \`${base}\`${publicBaseUrl && publicBaseUrl !== base ? ` (public fallback: \`${publicBaseUrl}\`)` : ""}
- Key: \`KANBAI_API_KEY\` from your secret store / environment (from the connect brief).
  Send \`Authorization: Bearer $KANBAI_API_KEY\` on every call. Never print the key.
- Send a normal \`User-Agent\` header (e.g. \`${AGENT_USER_AGENT}\`): CDN bot filters
  in front of the public URL reject bare HTTP clients with 403 "error code: 1010".
- 401 means the key was rotated: ask the owner for a fresh connect brief.
- Call \`GET /me\` once per session; its \`service.version\` tells you when to re-fetch
  this skill from \`${publicBaseUrl || base}/skill.md\`.

${body.trim()}
`;
}
