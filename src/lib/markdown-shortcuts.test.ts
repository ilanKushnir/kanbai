import test from "node:test";
import assert from "node:assert/strict";

import { wrapInline, toggleLinePrefix, continueListOnEnter } from "./markdown-shortcuts";

// ── wrapInline ──

test("wrapInline wraps a selection and keeps it selected", () => {
  const r = wrapInline("make this bold", 5, 9, "**");
  assert.equal(r.text, "make **this** bold");
  assert.equal(r.text.slice(r.start, r.end), "this");
});

test("wrapInline with an empty selection inserts a pair and parks the caret inside", () => {
  const r = wrapInline("note ", 5, 5, "**");
  assert.equal(r.text, "note ****");
  assert.equal(r.start, 7);
  assert.equal(r.end, 7);
});

test("wrapInline toggles off when the selection is already wrapped (markers outside)", () => {
  const r = wrapInline("a **bold** b", 4, 8, "**"); // "bold" selected inside markers
  assert.equal(r.text, "a bold b");
  assert.equal(r.text.slice(r.start, r.end), "bold");
});

test("wrapInline toggles off when markers are part of the selection", () => {
  const r = wrapInline("a **bold** b", 2, 10, "**"); // "**bold**" fully selected
  assert.equal(r.text, "a bold b");
  assert.equal(r.text.slice(r.start, r.end), "bold");
});

test("wrapInline handles italic underscore and inline code markers", () => {
  assert.equal(wrapInline("x", 0, 1, "_").text, "_x_");
  assert.equal(wrapInline("ls -la", 0, 6, "`").text, "`ls -la`");
});

// ── toggleLinePrefix ──

test("checklist prefix is added to every selected line", () => {
  const r = toggleLinePrefix("milk\neggs", 0, 9, "checklist");
  assert.equal(r.text, "- [ ] milk\n- [ ] eggs");
});

test("checklist prefix toggles off, recognizing checked boxes too", () => {
  const r = toggleLinePrefix("- [ ] milk\n- [x] eggs", 0, 21, "checklist");
  assert.equal(r.text, "milk\neggs");
});

test("a caret on a single line converts just that line", () => {
  const r = toggleLinePrefix("first\nsecond\nthird", 8, 8, "checklist");
  assert.equal(r.text, "first\n- [ ] second\nthird");
  // caret shifted with the inserted prefix, still on the same line
  assert.equal(r.start, 14);
});

test("quote prefix toggles on and off", () => {
  const on = toggleLinePrefix("wise words", 0, 10, "quote");
  assert.equal(on.text, "> wise words");
  const off = toggleLinePrefix(on.text, 0, on.text.length, "quote");
  assert.equal(off.text, "wise words");
});

test("mixed selection (some prefixed) completes the set instead of toggling off", () => {
  const r = toggleLinePrefix("- [ ] a\nb", 0, 9, "checklist");
  assert.equal(r.text, "- [ ] a\n- [ ] b");
});

// ── continueListOnEnter ──

test("Enter on a checklist item continues with an unchecked box", () => {
  const text = "- [x] done thing";
  const r = continueListOnEnter(text, text.length);
  assert.equal(r?.text, "- [x] done thing\n- [ ] ");
  assert.equal(r?.start, r?.text.length);
});

test("Enter on a bullet continues the bullet, preserving indent", () => {
  const text = "  - point";
  const r = continueListOnEnter(text, text.length);
  assert.equal(r?.text, "  - point\n  - ");
});

test("Enter on an EMPTY item exits the list (drops the marker)", () => {
  const text = "- [ ] a\n- [ ] ";
  const r = continueListOnEnter(text, text.length);
  assert.equal(r?.text, "- [ ] a\n");
  assert.equal(r?.start, r?.text.length);
});

test("Enter on a plain line returns null (caller inserts a normal newline)", () => {
  assert.equal(continueListOnEnter("just prose", 10), null);
});

test("Enter mid-line splits after the caret and continues the marker", () => {
  const text = "- [ ] buy milk";
  const r = continueListOnEnter(text, 9); // after "buy"... caret inside the item
  assert.equal(r?.text, "- [ ] buy\n- [ ]  milk");
});
