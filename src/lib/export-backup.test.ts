import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guards for the backup/offline-checklist/progress-import feature — built for
// server downtime: export a checklist, tick items off from the file itself,
// import the progress file once the server is back.
const exportSvc = readFileSync("src/lib/services/export.ts", "utf8");
const importRoute = readFileSync("src/app/api/import/progress/route.ts", "utf8");
const backupRoute = readFileSync("src/app/api/export/backup/route.ts", "utf8");
const checklistRoute = readFileSync("src/app/api/export/checklist/route.ts", "utf8");

test("Exports are scoped to the user's accessible boards and own notes", () => {
  assert.match(exportSvc, /boardWhereForContext\(ctx\)/);
  assert.match(exportSvc, /userId: ctx\.user\.id/);
  // Soft-deleted rows never leak into a backup.
  assert.match(exportSvc, /deletedAt: null/);
});

test("Checklist is fully offline-capable and escapes user content", () => {
  // localStorage persistence keyed per export, so ticks survive reopening the file.
  assert.match(exportSvc, /localStorage\.setItem\(KEY/);
  // Progress file downloadable AND copyable (clipboard fallback for file://).
  assert.match(exportSvc, /kanbai-progress-/);
  assert.match(exportSvc, /navigator\.clipboard/);
  // XSS hygiene: titles/bodies run through the escaper; RTL-safe rendering.
  assert.match(exportSvc, /esc\(t\.title\)/);
  assert.match(exportSvc, /dir="auto"/);
  // Unsorted notes are part of the checklist (the user asked for them explicitly).
  assert.match(exportSvc, /"Unsorted"/);
});

test("Progress import is idempotent and ownership-checked", () => {
  // Notes: only the caller's own, un-done notes get stamped.
  assert.match(importRoute, /note\.userId !== ctx\.user\.id/);
  assert.match(importRoute, /if \(note\.doneOn\)/);
  // Tickets: access asserted, already-done counted not re-moved.
  assert.match(importRoute, /assertTicketAccess\(ctx, item\.id, true\)/);
  assert.match(importRoute, /ticket\.column\.isDone/);
  // Per-item failures don't abort the batch.
  assert.match(importRoute, /skipped\.push/);
});

test("Export routes download as named files and are never cached", () => {
  for (const src of [backupRoute, checklistRoute]) {
    assert.match(src, /Content-Disposition/);
    assert.match(src, /no-store/);
    assert.match(src, /getCurrentContext\(\)/);
  }
});
