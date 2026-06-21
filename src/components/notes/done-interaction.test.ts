import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const notesView = readFileSync("src/components/notes/notes-view.tsx", "utf8");
const globalsCss = readFileSync("src/app/globals.css", "utf8");

test("Done toast Undo clears pending animation and restores undone state", () => {
  const undoHandler = notesView.slice(notesView.indexOf('actionLabel: "Undo"'), notesView.indexOf("const timer = setTimeout"));
  assert.match(undoHandler, /clearDoneAnimation\(note\.id\)/);
  assert.match(undoHandler, /setDoneLandingId/);
  assert.match(undoHandler, /patchNote\(note\.id, \{ doneOn: null \}\)/);
});

test("Done animation has no lateral or collapsing motion", () => {
  const animation = globalsCss.slice(globalsCss.indexOf("@keyframes done-slide"), globalsCss.indexOf("@keyframes confetti-pop"));
  assert.doesNotMatch(animation, /translate3d\([^,]+px,/);
  assert.doesNotMatch(animation, /translateX|max-height|padding-top|padding-bottom|margin-top/);
  assert.match(animation, /translate3d\(0,3px,0\)/);
});
