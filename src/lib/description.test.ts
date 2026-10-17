import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDescription } from "./sanitize";
import { descriptionToPlainText, isHtmlDescription, unwrapEscapedMarkdown } from "./description";

test("Markdown is stored as written (no escaping, no <p> wrapping)", () => {
  const md = "# Plan\n\n## Status\nDeferred.\n\n- a < b\n- [ ] check";
  assert.equal(normalizeDescription(md), md);
  assert.equal(isHtmlDescription(md), false);
});

test("Markdown an older version escaped into <p>/<br> comes back as Markdown", () => {
  const legacy = "<p># Advanced Later</p><p>## Status<br>Deferred &amp; parked.</p><p>- one<br>- two</p>";
  assert.equal(normalizeDescription(legacy), "# Advanced Later\n\n## Status\nDeferred & parked.\n\n- one\n- two");
});

test("real rich HTML stays HTML and is sanitized", () => {
  assert.equal(normalizeDescription('<p>Hi <b>there</b><script>x()</script></p>'), "<p>Hi <b>there</b></p>");
  // Plain prose wrapped in <p> (no Markdown syntax) is left as HTML.
  assert.equal(unwrapEscapedMarkdown("<p>Just a sentence.</p>"), null);
  // Formatting tags other than p/br mean it was authored as HTML.
  assert.equal(unwrapEscapedMarkdown("<p><b>#1</b></p><ul><li>- x</li></ul>"), null);
});

test("plain-text excerpt drops Markdown syntax", () => {
  assert.equal(descriptionToPlainText("## Status\n- [ ] **Book** [slot](https://x.y)"), "Status\nBook slot");
});
