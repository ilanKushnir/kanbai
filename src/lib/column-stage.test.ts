import assert from "node:assert/strict";
import test from "node:test";
import { deriveColumnStage, resolveColumnStage, isColumnStage } from "./column-stage";

test("isDone columns always resolve to done, whatever is stored or named", () => {
  assert.equal(deriveColumnStage("Anything", true), "done");
  assert.equal(resolveColumnStage("intake", "Ideas", true), "done");
  assert.equal(resolveColumnStage(null, "Shipped", true), "done");
});

test("names default sensibly for existing columns", () => {
  assert.equal(deriveColumnStage("Ideas", false), "intake");
  assert.equal(deriveColumnStage("Inbox", false), "intake");
  assert.equal(deriveColumnStage("Someday", false), "intake");
  assert.equal(deriveColumnStage("Backlog", false), "backlog");
  assert.equal(deriveColumnStage("To Do", false), "backlog");
  assert.equal(deriveColumnStage("Next up", false), "backlog");
  assert.equal(deriveColumnStage("In Progress", false), "active");
  assert.equal(deriveColumnStage("Doing", false), "active");
  assert.equal(deriveColumnStage("Review", false), "active");
});

test("a stored valid stage wins over the name", () => {
  assert.equal(resolveColumnStage("intake", "Whatever", false), "intake");
  assert.equal(resolveColumnStage("active", "Backlog", false), "active");
});

test("a stored invalid/legacy stage falls back to name derivation", () => {
  assert.equal(resolveColumnStage("bogus", "Backlog", false), "backlog");
  assert.equal(resolveColumnStage(null, "In Progress", false), "active");
  assert.equal(resolveColumnStage(undefined, "Ideas", false), "intake");
});

test("a stored done stage without the isDone flag does not fake completion styling", () => {
  // stage "done" is only honored when isDone is true — the flag is the source
  // of truth for completion counting, so the visuals must follow it.
  assert.equal(resolveColumnStage("done", "Archive", false), "active");
});

test("isColumnStage guards the enum", () => {
  assert.equal(isColumnStage("intake"), true);
  assert.equal(isColumnStage("done"), true);
  assert.equal(isColumnStage("idea"), false);
  assert.equal(isColumnStage(null), false);
});
