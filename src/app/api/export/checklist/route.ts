import { handler } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { gatherExportData, buildChecklistHtml } from "@/lib/services/export";

/**
 * Self-contained offline checklist (download). Open the file anywhere — even
 * with the server down — tick items off, then import the progress file it
 * produces via /api/import/progress when the app is back up.
 */
export const GET = handler(async () => {
  const ctx = await getCurrentContext();
  const data = await gatherExportData(ctx);
  const day = data.exportedAt.slice(0, 10);
  return new Response(buildChecklistHtml(data), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="kanbai-checklist-${day}.html"`,
      "Cache-Control": "no-store",
    },
  });
});
