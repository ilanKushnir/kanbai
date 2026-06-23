import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const notesView = readFileSync("src/components/notes/notes-view.tsx", "utf8");

test("Notes rows render the green done check immediately during pending undo", () => {
  const row = notesView.slice(notesView.indexOf("function NoteRow"), notesView.indexOf("function NoteMarkdown"));
  assert.match(row, /const done = note\.doneOn != null \|\| justDone;/);
  assert.match(row, /aria-label=\{done \? "Mark not done" : "Mark done"\}/);
});

test("Clicking a note again undoes it — even during the pending settle window", () => {
  const fn = notesView.slice(notesView.indexOf("function toggleDone"), notesView.indexOf("function archive"));
  // It must detect an in-flight completion (timer still pending)…
  assert.match(fn, /doneTimers\.current\.has\(note\.id\)/);
  // …and treat both persisted-done AND pending as "done" so a second click reverts.
  assert.match(fn, /note\.doneOn != null \|\| pending/);
});
