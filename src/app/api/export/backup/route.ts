import { handler } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { gatherExportData } from "@/lib/services/export";

/** Full JSON backup of the user's boards, tickets and notes (download). */
export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  const data = await gatherExportData(ctx);
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kanbai-backup-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
