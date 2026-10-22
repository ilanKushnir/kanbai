import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeDay, dropInto, moveToPart, nextPlan, parsePlan, partOfDay, type Slot } from "./day-plan";

const ids = (xs: { item: { id: string } }[]) => xs.map((x) => x.item.id);
const items = (...xs: string[]) => xs.map((id) => ({ id }));

test("no plan: the usual order, all anytime", () => {
  const out = arrangeDay(items("a", "b"), undefined);
  assert.deepEqual(ids(out), ["a", "b"]);
  assert.ok(out.every((x) => x.part === null));
});

test("unplanned items first, then anytime, morning, afternoon, evening in plan order", () => {
  const plan = parsePlan([
    { id: "e1", part: "evening" },
    { id: "m1", part: "morning" },
    { id: "x", part: null },
    { id: "m2", part: "morning" },
    { id: "gone", part: "afternoon" },
  ]);
  const out = arrangeDay(items("m2", "new", "e1", "x", "m1"), plan);
  assert.deepEqual(ids(out), ["new", "x", "m1", "m2", "e1"]);
  assert.deepEqual(out.map((x) => x.part), [null, null, "morning", "morning", "evening"]);
});

test("parsePlan drops junk and duplicates, unknown parts become anytime", () => {
  assert.deepEqual(parsePlan("not json"), []);
  assert.deepEqual(parsePlan('[{"id":"a","part":"noon"},{"id":"a"},{"part":"morning"},null]'), [{ id: "a", part: null }]);
});

test("nextPlan keeps off-screen items' places after the section's new order", () => {
  const prev = [{ id: "done", part: "morning" as const }, { id: "a", part: null }];
  assert.deepEqual(nextPlan([{ id: "a", part: "evening" }], prev), [
    { id: "a", part: "evening" },
    { id: "done", part: "morning" },
  ]);
});

const split: Slot[] = [
  { kind: "item", id: "a", part: null },
  { kind: "part", part: "morning" },
  { kind: "item", id: "m", part: "morning" },
  { kind: "part", part: "afternoon" },
  { kind: "part", part: "evening" },
  { kind: "item", id: "e", part: "evening" },
];

test("with the split showing, the divider above the drop decides the part", () => {
  assert.deepEqual(dropInto(split, "x", "part:evening", true), [
    { id: "a", part: null },
    { id: "m", part: "morning" },
    { id: "x", part: "afternoon" },
    { id: "e", part: "evening" },
  ]);
  assert.deepEqual(dropInto(split, "x", "part:morning", true)[1], { id: "x", part: null });
  assert.deepEqual(dropInto(split, "x", null, true).at(-1), { id: "x", part: "evening" });
});

test("without the split, the item joins the neighbour above (or below at the top)", () => {
  const flat: Slot[] = [
    { kind: "item", id: "m", part: "morning" },
    { kind: "item", id: "e", part: "evening" },
  ];
  assert.deepEqual(dropInto(flat, "x", "e", false), [
    { id: "m", part: "morning" },
    { id: "x", part: "morning" },
    { id: "e", part: "evening" },
  ]);
  assert.deepEqual(dropInto(flat, "x", "m", false)[0], { id: "x", part: "morning" });
  assert.deepEqual(dropInto([], "x", null, false), [{ id: "x", part: null }]);
});

test("moveToPart puts the item at the end of that part", () => {
  const section = [
    { id: "a", part: null },
    { id: "m", part: "morning" as const },
    { id: "e", part: "evening" as const },
  ];
  assert.deepEqual(moveToPart(section, "a", "afternoon").map((e) => e.id), ["m", "a", "e"]);
  assert.deepEqual(moveToPart(section, "e", null).map((e) => e.id), ["a", "e", "m"]);
  assert.deepEqual(moveToPart(section, "a", "evening").at(-1), { id: "a", part: "evening" });
});

test("partOfDay", () => {
  const at = (h: number) => new Date(2026, 9, 22, h, 0);
  assert.equal(partOfDay(at(3)), null);
  assert.equal(partOfDay(at(8)), "morning");
  assert.equal(partOfDay(at(13)), "afternoon");
  assert.equal(partOfDay(at(20)), "evening");
});
