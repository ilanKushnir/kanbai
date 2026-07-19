import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Static guards for the shared motion system: tokens live in globals.css and
 * every surface animates through them, so one voice (quick start, expo-out
 * settle) holds app-wide — and prefers-reduced-motion silences all of it.
 */
const css = readFileSync("src/app/globals.css", "utf8");
const notesView = readFileSync("src/components/notes/notes-view.tsx", "utf8");
const menu = readFileSync("src/components/ui/menu.tsx", "utf8");
const button = readFileSync("src/components/ui/button.tsx", "utf8");

const composer = notesView.slice(
  notesView.indexOf("{/* Composer"),
  notesView.indexOf("<DndContext"),
);

test("globals.css defines the shared motion tokens", () => {
  for (const token of ["--motion-fast", "--motion-base", "--motion-slow", "--ease-out-soft", "--ease-out-emph"]) {
    assert.match(css, new RegExp(`${token}:`), `missing ${token}`);
  }
});

test("animation utilities ease through the tokens, not inline curves", () => {
  assert.match(css, /\.animate-scale-in \{ animation: scale-in [\d.]+s var\(--ease-out-emph\)/);
  assert.match(css, /\.animate-toast-in \{ animation: toast-in [\d.]+s var\(--ease-out-emph\)/);
  // the shared expo-out curve is declared once — utilities must not re-inline it
  assert.equal(css.split("cubic-bezier(0.16, 1, 0.3, 1)").length, 2, "expo-out curve declared exactly once");
});

test("composer expand/collapse animates the min-height floor only", () => {
  // Animating min-height (not height) keeps AutoGrow's per-keystroke inline
  // height changes instant while the expand toggle glides.
  const block = css.slice(css.indexOf(".kb-composer textarea {"), css.indexOf(".kb-composer textarea::placeholder"));
  assert.match(block, /transition: min-height var\(--motion-slow\) var\(--ease-out-emph\)/);
});

test("composer expand actually grows the canvas on desktop too", () => {
  // md:min-h-40 must ride along — the base md:min-h-8 otherwise wins the
  // cascade at md+ and desktop "Expand" changes nothing but the placeholder.
  assert.match(composer, /min-h-40 md:min-h-40/);
});

test("composer expand toggle stays accessible and hands focus to the textarea", () => {
  assert.match(composer, /aria-expanded=\{expanded\}/);
  assert.match(notesView, /function toggleExpanded/);
  assert.match(notesView, /querySelector\("textarea"\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test("menus enter from the edge they open on", () => {
  assert.match(menu, /"bottom" in pos \? "animate-slide-up-fade" : "animate-slide-down-fade"/);
  assert.match(css, /@keyframes slide-up-fade/);
  assert.match(css, /\.animate-slide-up-fade/);
});

test("buttons give subtle press feedback", () => {
  assert.match(button, /active:scale-\[0\.98\]/);
});

test("prefers-reduced-motion flattens animations, transitions, loops, and smooth scroll", () => {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(start >= 0, "missing reduced-motion block");
  const block = css.slice(start, css.indexOf("}\n}", start));
  assert.match(block, /animation-duration: 0\.001ms !important/);
  assert.match(block, /transition-duration: 0\.001ms !important/);
  // infinite loops (pulse, shimmer) must stop, not just speed up
  assert.match(block, /animation-iteration-count: 1 !important/);
  assert.match(block, /scroll-behavior: auto/);
});

test("notes section reveals are opacity-only so dnd-kit measurements stay true", () => {
  const reveal = notesView.slice(notesView.indexOf("{open && ("), notesView.indexOf("<SortableContext"));
  assert.match(reveal, /animate-fade-in/);
  assert.doesNotMatch(reveal, /animate-slide|animate-scale/);
});
