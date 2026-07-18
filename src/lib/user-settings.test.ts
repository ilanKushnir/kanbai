import test from "node:test";
import assert from "node:assert/strict";

import { parseUserSettings, MAX_PINNED_BOARDS } from "./user-settings";

// pinnedBoardIds joined the User.settings blob for per-user board pins; the
// parser must keep hostile/legacy blobs from ever surfacing a bad shape.

test("missing/empty/corrupt settings parse to an empty pin list", () => {
  assert.deepEqual(parseUserSettings(null).pinnedBoardIds, []);
  assert.deepEqual(parseUserSettings(undefined).pinnedBoardIds, []);
  assert.deepEqual(parseUserSettings("not json").pinnedBoardIds, []);
  assert.deepEqual(parseUserSettings("{}").pinnedBoardIds, []);
});

test("each parse returns an independent array (safe to mutate)", () => {
  const a = parseUserSettings(null);
  a.pinnedBoardIds.push("x");
  assert.deepEqual(parseUserSettings(null).pinnedBoardIds, []);
});

test("valid pin lists pass through in order", () => {
  const raw = JSON.stringify({ pinnedBoardIds: ["b2", "b1"] });
  assert.deepEqual(parseUserSettings(raw).pinnedBoardIds, ["b2", "b1"]);
});

test("non-array shapes and junk entries are dropped, duplicates collapsed", () => {
  assert.deepEqual(parseUserSettings(JSON.stringify({ pinnedBoardIds: "b1" })).pinnedBoardIds, []);
  assert.deepEqual(parseUserSettings(JSON.stringify({ pinnedBoardIds: 7 })).pinnedBoardIds, []);
  const raw = JSON.stringify({ pinnedBoardIds: ["b1", 3, null, "", "b2", "b1", {}] });
  assert.deepEqual(parseUserSettings(raw).pinnedBoardIds, ["b1", "b2"]);
});

test("pin list is capped", () => {
  const raw = JSON.stringify({
    pinnedBoardIds: Array.from({ length: MAX_PINNED_BOARDS + 20 }, (_, i) => `b${i}`),
  });
  assert.equal(parseUserSettings(raw).pinnedBoardIds.length, MAX_PINNED_BOARDS);
});

test("pins don't disturb the other preference fields", () => {
  const raw = JSON.stringify({ defaultLanding: "notes", weekStartsOn: 1, pinnedBoardIds: ["b1"] });
  const s = parseUserSettings(raw);
  assert.equal(s.defaultLanding, "notes");
  assert.equal(s.weekStartsOn, 1);
  assert.equal(s.handedness, "right");
  assert.deepEqual(s.pinnedBoardIds, ["b1"]);
});
