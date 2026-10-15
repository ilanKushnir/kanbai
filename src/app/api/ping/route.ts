// Reachability probe for the offline sync engine: tiny, uncached, no auth.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
