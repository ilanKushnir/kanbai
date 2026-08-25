import assert from "node:assert/strict";
import test from "node:test";
import { orderColumnTickets } from "@/lib/services/boards";

const t = (id: string, completedAt: string | null, createdAt = "2020-01-01T00:00:00Z") => ({
  id,
  completedAt: completedAt ? new Date(completedAt) : null,
  createdAt: new Date(createdAt),
});

test("non-done columns keep their incoming (manual position) order untouched", () => {
  const items = [t("a", null), t("b", null), t("c", null)];
  assert.deepEqual(orderColumnTickets(items, false, false).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(orderColumnTickets(items, false, true).map((x) => x.id), ["a", "b", "c"]);
});

test("done column, authed payload (asc): stored oldest→newest so the board's reversal shows newest completion on top", () => {
  const items = [
    t("old", "2026-01-01T09:00:00Z"),
    t("new", "2026-03-01T09:00:00Z"),
    t("mid", "2026-02-01T09:00:00Z"),
  ];
  // ascending by completion → the client reverses this to new, mid, old
  assert.deepEqual(orderColumnTickets(items, true, false).map((x) => x.id), ["old", "mid", "new"]);
});

test("done column, public payload (desc): newest completion first, rendered as-is", () => {
  const items = [
    t("old", "2026-01-01T09:00:00Z"),
    t("new", "2026-03-01T09:00:00Z"),
    t("mid", "2026-02-01T09:00:00Z"),
  ];
  assert.deepEqual(orderColumnTickets(items, true, true).map((x) => x.id), ["new", "mid", "old"]);
});

test("legacy done tickets with no completedAt fall back to createdAt, never NaN-sort", () => {
  const items = [
    t("legacy", null, "2026-01-05T00:00:00Z"),
    t("recent", "2026-06-01T00:00:00Z", "2026-05-01T00:00:00Z"),
    t("older-legacy", null, "2026-01-01T00:00:00Z"),
  ];
  // public/newest-first: recent (Jun) > legacy (Jan 5) > older-legacy (Jan 1)
  assert.deepEqual(
    orderColumnTickets(items, true, true).map((x) => x.id),
    ["recent", "legacy", "older-legacy"],
  );
});

test("does not mutate the input array", () => {
  const items = [t("a", "2026-02-01T00:00:00Z"), t("b", "2026-01-01T00:00:00Z")];
  const before = items.map((x) => x.id);
  orderColumnTickets(items, true, true);
  assert.deepEqual(items.map((x) => x.id), before);
});
