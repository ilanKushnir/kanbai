import assert from "node:assert/strict";
import test from "node:test";
import { textDirection } from "./text-direction";

test("Hebrew-first titles are RTL, even with trailing English", () => {
  assert.equal(textDirection("לתקן את הבאג"), "rtl");
  assert.equal(textDirection("לתקן bug ב-API"), "rtl");
});

test("Arabic-first titles are RTL", () => {
  assert.equal(textDirection("إصلاح الخطأ في API"), "rtl");
});

test("English-first titles stay LTR, even with trailing Hebrew", () => {
  assert.equal(textDirection("Fix the bug"), "ltr");
  assert.equal(textDirection("Deploy אתר to prod"), "ltr");
});

test("Leading neutrals (digits, punctuation, emoji, whitespace) are skipped", () => {
  assert.equal(textDirection("1. משימה ראשונה"), "rtl");
  assert.equal(textDirection('  "משהו" חשוב'), "rtl");
  assert.equal(textDirection("🔥 דחוף!"), "rtl");
  assert.equal(textDirection("(a) task one"), "ltr");
  assert.equal(textDirection("42 tasks left"), "ltr");
});

test("No strong characters defaults to LTR", () => {
  assert.equal(textDirection(""), "ltr");
  assert.equal(textDirection("123 – 456 🙂"), "ltr");
});

test("Other LTR scripts (Cyrillic, Greek) are LTR", () => {
  assert.equal(textDirection("Исправить ошибку"), "ltr");
  assert.equal(textDirection("Διόρθωση σφάλματος"), "ltr");
});
