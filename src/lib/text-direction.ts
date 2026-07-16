// First-strong-character text direction, mirroring the Unicode bidi "auto"
// heuristic: scan for the first strongly-directional character and let it set
// the base direction. Used where we can't rely on the browser's dir="auto"
// (generated HTML exports, conditional styling); interactive inputs and
// display elements should just use dir="auto" directly.

/** Strong RTL: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan + Arabic/Hebrew presentation forms. */
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/u;
/** Strong LTR: Latin, Greek, Cyrillic, Armenian-adjacent and most other letter scripts. */
const LTR_CHAR = /[A-Za-zÀ-֏ऀ-῿Ⰰ-퟿]/u;

/**
 * The base direction of a line of user text: "rtl" if the first strong
 * character is right-to-left (Hebrew/Arabic/…), otherwise "ltr". Digits,
 * punctuation, emoji and whitespace are direction-neutral and skipped, so
 * "1. משימה" is RTL and "(a) task" stays LTR.
 */
export function textDirection(text: string): "rtl" | "ltr" {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return "ltr";
}
