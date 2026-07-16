import assert from "node:assert/strict";
import test from "node:test";

import {
  insertInNewestFirstOrder,
  isDenseSection,
  moveInNewestFirstOrder,
  nextVisibleCount,
  visibleNewestFirstIds,
} from "./board-section-visibility";

test("board sections render most recent tickets first and hide older tickets when dense", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);

  assert.equal(isDenseSection(ids.length, 4, 2), true);
  assert.deepEqual(visibleNewestFirstIds(ids, 4), ["t10", "t9", "t8", "t7"]);
});

test("board sections do not collapse for a small non-dense tail", () => {
  const ids = ["oldest", "middle", "newest"];

  assert.equal(isDenseSection(ids.length, 4, 2), false);
  assert.deepEqual(visibleNewestFirstIds(ids, 4), ["newest", "middle", "oldest"]);
});

test("show more expands dense sections in batches instead of all at once", () => {
  const ids = Array.from({ length: 14 }, (_, i) => `t${i + 1}`);

  const first = 4;
  const second = nextVisibleCount(first, ids.length, 4);
  assert.equal(second, 8);
  assert.deepEqual(visibleNewestFirstIds(ids, second), ["t14", "t13", "t12", "t11", "t10", "t9", "t8", "t7"]);

  const third = nextVisibleCount(second, ids.length, 4);
  assert.equal(third, 12);
  assert.deepEqual(visibleNewestFirstIds(ids, third), [
    "t14",
    "t13",
    "t12",
    "t11",
    "t10",
    "t9",
    "t8",
    "t7",
    "t6",
    "t5",
    "t4",
    "t3",
  ]);
});


test("same-section drag reorder keeps newest-first visual semantics", () => {
  const storedOldestFirst = ["oldest", "middle", "newest"];

  const reordered = moveInNewestFirstOrder(storedOldestFirst, "newest", "middle");

  assert.deepEqual(reordered, ["oldest", "newest", "middle"]);
  assert.deepEqual(visibleNewestFirstIds(reordered, reordered.length), ["middle", "newest", "oldest"]);
});

test("cross-section drag insert keeps the card at the visual newest-first slot", () => {
  const storedOldestFirst = ["oldest", "middle", "newest"];

  const inserted = insertInNewestFirstOrder(storedOldestFirst, "incoming", "middle");

  assert.deepEqual(inserted, ["oldest", "middle", "incoming", "newest"]);
  assert.deepEqual(visibleNewestFirstIds(inserted, inserted.length), ["newest", "incoming", "middle", "oldest"]);
});
