import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Static guards for the shared motion system: tokens live in globals.css and
 * every surface animates through them, so one voice (quick start, expo-out
 * settle) holds app-wide — and prefers-reduced-motion silences all of it.
 */
const css = readFileSync("src/app/globals.css", "utf8");
const menu = readFileSync("src/components/ui/menu.tsx", "utf8");
const button = readFileSync("src/components/ui/button.tsx", "utf8");
const todayView = readFileSync("src/components/today/today-view.tsx", "utf8");

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

test("quick-add well animates its min-height floor only", () => {
  // Animating min-height (not height) keeps the per-keystroke auto-grow instant.
  assert.match(css, /\.kb-quickadd textarea \{ transition: min-height var\(--motion-slow\) var\(--ease-out-emph\); \}/);
});

test("task check gives tactile feedback and completed rows settle out through the shared curve", () => {
  const check = css.slice(css.indexOf(".kb-check {"), css.indexOf(".kb-row-done"));
  assert.match(check, /transform var\(--motion-fast\) var\(--ease-out-emph\)/);
  assert.match(check, /\.kb-check:active \{ transform: scale\(0\.9\); \}/);
  // Completing: check presses + draws, a ring breathes out, the title strikes, the row folds.
  assert.match(css, /\.is-completing \.kb-check \{ animation: check-press [\d.]+s var\(--ease-out-emph\)/);
  assert.match(css, /\.is-completing \.kb-check svg \{ animation: check-draw/);
  assert.match(css, /\.is-completing \.kb-strike \{ background-size: 100% 1px; transition: background-size [\d.]+s var\(--ease-out-soft\)/);
  assert.match(css, /\.kb-row-wrap \{ display: grid; grid-template-rows: 1fr; transition: grid-template-rows [\d.]+s var\(--ease-out-soft\)/);
  assert.match(todayView, /phase !== "idle" && "is-completing"/);
  assert.match(todayView, /phase === "leaving" && "is-leaving"/);
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

test("today section reveals are opacity-only so row geometry stays true", () => {
  const reveal = todayView.slice(todayView.indexOf("{open && ("), todayView.indexOf("{isEmptyToday && ("));
  assert.match(reveal, /animate-fade-in/);
  assert.doesNotMatch(reveal, /animate-slide|animate-scale/);
});
