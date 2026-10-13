import assert from "node:assert/strict";
import test from "node:test";
import { parseQuickAdd } from "./quick-add";

const boards = [
  { id: "b1", name: "Personal", slug: "personal" },
  { id: "b2", name: "KWS Homelab", slug: "kws-homelab" },
  { id: "b3", name: "Astra", slug: "astra" },
];
// Tuesday 2026-10-13, local
const now = new Date(2026, 9, 13, 10, 0, 0);

test("plain text is a title with no day", () => {
  const r = parseQuickAdd("Buy oat milk", boards, now);
  assert.equal(r.title, "Buy oat milk");
  assert.equal(r.day, null);
  assert.equal(r.priority, null);
  assert.equal(r.board, null);
});

test("english date words", () => {
  assert.equal(parseQuickAdd("Call the bank tomorrow", boards, now).day, "2026-10-14");
  assert.equal(parseQuickAdd("Call the bank today", boards, now).day, "2026-10-13");
  assert.equal(parseQuickAdd("Dentist next week", boards, now).day, "2026-10-20");
  assert.equal(parseQuickAdd("Pay rent in 3 days", boards, now).day, "2026-10-16");
  assert.equal(parseQuickAdd("Renew passport 2026-11-02", boards, now).day, "2026-11-02");
  assert.equal(parseQuickAdd("Renew passport 2/11", boards, now).day, "2026-11-02");
  const fri = parseQuickAdd("Ship v2 friday", boards, now);
  assert.equal(fri.day, "2026-10-16");
  assert.equal(fri.title, "Ship v2");
});

test("hebrew date words and weekdays", () => {
  assert.equal(parseQuickAdd("לקבוע תור לרופא מחר", boards, now).day, "2026-10-14");
  assert.equal(parseQuickAdd("לקבוע תור לרופא מחר", boards, now).title, "לקבוע תור לרופא");
  assert.equal(parseQuickAdd("להתקשר לאמא היום", boards, now).day, "2026-10-13");
  assert.equal(parseQuickAdd("קניות ביום חמישי", boards, now).day, "2026-10-15");
  assert.equal(parseQuickAdd("קניות ביום חמישי", boards, now).title, "קניות");
  assert.equal(parseQuickAdd("מחרתיים לבדוק גיבוי", boards, now).day, "2026-10-15");
});

test("priority tokens", () => {
  const r = parseQuickAdd("Fix the backup !high", boards, now);
  assert.equal(r.priority, "high");
  assert.equal(r.title, "Fix the backup");
  assert.equal(parseQuickAdd("Server down urgent", boards, now).priority, "urgent");
  assert.equal(parseQuickAdd("Server down !דחוף", boards, now).priority, "urgent");
});

test("board by #tag, prefix and multi-word", () => {
  assert.equal(parseQuickAdd("Water plants #personal", boards, now).board?.id, "b1");
  assert.equal(parseQuickAdd("Water plants #pers", boards, now).board?.id, "b1");
  const r = parseQuickAdd("Rotate certs #kws homelab tomorrow", boards, now);
  assert.equal(r.board?.id, "b2");
  assert.equal(r.title, "Rotate certs");
  assert.equal(r.day, "2026-10-14");
  assert.equal(parseQuickAdd("Rotate certs @astra", boards, now).board?.id, "b3");
});

test("trailing 'to <board>' hint", () => {
  const r = parseQuickAdd("Rotate certs to KWS Homelab", boards, now);
  assert.equal(r.board?.id, "b2");
  assert.equal(r.title, "Rotate certs");
});

test("unknown tags stay in the title", () => {
  const r = parseQuickAdd("Read #book tonight", boards, now);
  assert.equal(r.board, null);
  assert.equal(r.title, "Read #book tonight");
});

test("hints describe what was understood", () => {
  const r = parseQuickAdd("Call bank tomorrow !high #personal", boards, now);
  assert.deepEqual(r.hints, ["Tomorrow", "High", "Personal"]);
});
