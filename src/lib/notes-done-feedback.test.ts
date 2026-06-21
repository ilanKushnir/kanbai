import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const notesView = readFileSync("src/components/notes/notes-view.tsx", "utf8");

test("Notes rows render the green done check immediately during pending undo", () => {
  const row = notesView.slice(notesView.indexOf("function NoteRow"), notesView.indexOf("function NoteMarkdown"));
  assert.match(row, /const done = note\.doneOn != null \|\| justDone;/);
  assert.match(row, /aria-label=\{done \? "Mark not done" : "Mark done"\}/);
});
