import type { NextConfig } from "next";

// Static import (not fs.readFileSync) so Turbopack can trace the dependency
// without a build-time file-read warning. Default import + attribute is required:
// on Node >=22.18 Next loads this file via the native ESM resolver, where JSON
// modules have no named exports and need `with { type: "json" }`.
import packageJson from "./package.json" with { type: "json" };

const { version } = packageJson;

const nextConfig: NextConfig = {
  // Inlined into the client bundle at build time; the SW registration appends it
  // to /sw.js?v=… so every release installs a fresh worker + cache.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  async headers() {
    // The SW script and manifest must never be cached long-term, or installed
    // PWAs keep running a stale worker (and its stale caches) across deploys.
    const noCache = [{ key: "Cache-Control", value: "no-cache, must-revalidate" }];
    return [
      { source: "/sw.js", headers: noCache },
      { source: "/manifest.webmanifest", headers: noCache },
    ];
  },
};

export default nextConfig;
