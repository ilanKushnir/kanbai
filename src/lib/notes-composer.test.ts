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

test("hidden submit button collapses out of layout so the expand button hugs the card edge", () => {
  // opacity alone kept the invisible "Add Note" button's width, floating the
  // expand button away from the right edge on mobile — width must collapse too
  assert.match(composer, /max-w-0/);
  assert.match(composer, /px-0/);
  // cancel the flex gap so the expand button sits flush when submit is hidden
  assert.match(composer, /-ml-1\.5/);
  assert.match(composer, /sm:-ml-2/);
  // the visible state restores width and padding
  assert.match(composer, /max-w-40/);
  assert.match(composer, /px-3\.5/);
});

test("Cmd/Ctrl+Enter submits, covering the expanded composer", () => {
  assert.match(composer, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "Enter"/);
  assert.match(composer, /submitDraft\(\)/);
});

test("composer focus is a single aqua halo — no stacked violet+aqua double ring", () => {
  const focus = globalsCss.slice(
    globalsCss.indexOf(".kb-composer:focus-within"),
    globalsCss.indexOf(".kb-composer-field"),
  );
  assert.doesNotMatch(focus, /0 0 0 6px/); // the old second ring
  assert.doesNotMatch(focus, /0 0 0 3px color-mix\(in oklab, var\(--iris-400\)/); // the old clashing violet ring
  assert.match(focus, /0 0 0 3px color-mix\(in oklab, var\(--aqua-400\)/);
});

test("composer has an inset writing well that brightens on focus", () => {
  assert.match(composer, /kb-composer-field/);
  assert.match(globalsCss, /\.kb-composer-field \{/);
  assert.match(globalsCss, /\.kb-composer:focus-within \.kb-composer-field/);
});

test("composer offers compact markdown formatting instead of syntax in the placeholder", () => {
  assert.match(composer, /role="toolbar"/);
  assert.match(composer, /applyFormat\(kind\)/);
  for (const kind of ["bold", "italic", "checklist", "code", "quote"]) {
    assert.ok(composer.includes(`"${kind}"`), `toolbar exposes ${kind}`);
  }
  assert.doesNotMatch(composer, /Jot something down/);
  // Cmd/Ctrl+B and +I formatting chords
  assert.match(composer, /e\.key === "b" \|\| e\.key === "i"/);
});

test("Enter continues checklists/bullets in the composer and the inline note editor", () => {
  assert.match(notesView, /continueListOnEnter/);
  assert.match(notesView, /listContinuation/);
});
