import { readFileSync } from "node:fs";
import { join } from "node:path";

// The worker script must be served from an extensionless dynamic route:
// Cloudflare force-caches *.js paths (e.g. the old /sw.js) with a multi-hour
// edge TTL regardless of origin headers, which left installed PWAs running
// stale workers. This route ships in the runtime image (the Dockerfile copies
// the whole app dir), so the source is read from disk once per server boot.
export const dynamic = "force-dynamic";

const swSource = readFileSync(join(process.cwd(), "src", "lib", "service-worker.js"), "utf8");

export function GET() {
  return new Response(swSource, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Service-Worker-Allowed": "/",
    },
  });
}
