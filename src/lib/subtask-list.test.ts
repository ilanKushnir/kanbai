import { test } from "node:test";
import assert from "node:assert/strict";
import { liftChecklist, newSubtasks, parseSubtasks, subtaskProgress } from "./subtask-list";

test("liftChecklist turns markdown checkboxes into subtasks and keeps the rest", () => {
  const { text, items } = liftChecklist("לסדר ליובל את Yuvalochi\n\nקודם כול:\n- [ ] לקנות לה מספר טלפון.\n- [x] לחבר לוואטסאפ\n* [ ] Home Assistant");
  assert.equal(text, "לסדר ליובל את Yuvalochi");
  assert.deepEqual(items, [
    { title: "לקנות לה מספר טלפון.", completed: false },
    { title: "לחבר לוואטסאפ", completed: true },
    { title: "Home Assistant", completed: false },
  ]);
});

test("liftChecklist leaves plain text and checklist-only text alone", () => {
  assert.deepEqual(liftChecklist("Buy milk"), { text: "Buy milk", items: [] });
  assert.deepEqual(liftChecklist("- [ ] only a list"), { text: "- [ ] only a list", items: [] });
  assert.equal(liftChecklist("Plan\n- normal bullet").items.length, 0);
});

test("parseSubtasks tolerates junk; newSubtasks trims and drops empties", () => {
  assert.deepEqual(parseSubtasks("not json"), []);
  assert.deepEqual(parseSubtasks('[{"id":"a","title":"x","completed":true},{"bad":1}]'), [{ id: "a", title: "x", completed: true }]);
  const made = newSubtasks(["  one ", "", "two"]);
  assert.deepEqual(made.map((s) => s.title), ["one", "two"]);
  assert.notEqual(made[0].id, made[1].id);
  assert.deepEqual(subtaskProgress([{ completed: true }, { completed: false }]), { done: 1, total: 2, open: 1 });
});
