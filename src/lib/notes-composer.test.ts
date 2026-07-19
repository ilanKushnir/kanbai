import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const notesView = readFileSync("src/components/notes/notes-view.tsx", "utf8");
const globalsCss = readFileSync("src/app/globals.css", "utf8");

const composer = notesView.slice(
  notesView.indexOf("{/* Composer"),
  notesView.indexOf("<DndContext"),
);
const dayChip = notesView.slice(notesView.indexOf("function DayChip"));

test("composer wears an inverted elevated purple capture surface with a focus-within state", () => {
  assert.match(composer, /kb-composer/);
  const css = globalsCss.slice(globalsCss.indexOf(".kb-composer"));
  assert.match(css, /linear-gradient\(145deg, #2a1765/);
  assert.match(css, /\.kb-composer:focus-within/);
  assert.match(css, /var\(--aqua-400\)/);
  assert.match(css, /0 24px 58px -26px/);
});

test("composer controls are tuned for the inverted purple panel", () => {
  assert.match(composer, /kb-composer-icon-button/);
  assert.match(composer, /kb-composer-submit/);
  assert.match(dayChip, /kb-composer-day-chip/);
  const css = globalsCss.slice(globalsCss.indexOf(".kb-composer"));
  assert.match(css, /\.kb-composer textarea::placeholder/);
  assert.match(css, /\.kb-composer-submit/);
});

test("composer textarea is 16px on mobile so iOS Safari doesn't zoom on focus", () => {
  assert.match(composer, /text-base/);
  assert.match(composer, /md:text-\[0\.95rem\]/);
});

test("composer input stays RTL/mixed-text safe", () => {
  assert.match(composer, /dir="auto"/);
});

test("composer controls keep ≥36px hit targets on mobile", () => {
  // mic, expand, and submit buttons all size up to h-9 below md
  assert.ok((composer.match(/\bh-9\b/g) ?? []).length >= 3);
  // the day chip lives outside the composer slice but sits in its toolbar
  assert.match(dayChip, /\bh-9\b/);
});

test("Cmd/Ctrl+Enter submits, covering the expanded composer", () => {
  assert.match(composer, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "Enter"/);
  assert.match(composer, /submitDraft\(\)/);
});
