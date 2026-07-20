/**
 * Minimal markdown editing helpers for the Notes composer — Apple-Notes-level,
 * not a rich editor. Pure text+selection transforms so they're unit-testable
 * and shared by the toolbar buttons and keyboard shortcuts. Rendering already
 * understands GFM (see ui/markdown.tsx); these only help WRITE it.
 */

export type TextSelection = { text: string; start: number; end: number };

/**
 * Wrap the selection in an inline marker (`**`, `_`, `` ` ``), or unwrap if it
 * is already wrapped (toggle). With no selection, insert an empty pair and park
 * the caret inside it.
 */
export function wrapInline(text: string, start: number, end: number, marker: string): TextSelection {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const m = marker.length;

  // Toggle off when the selection is wrapped — either just outside it
  // ("**sel**" selected without markers) or inside it ("**sel**" fully selected).
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -m) + selected + after.slice(m),
      start: start - m,
      end: end - m,
    };
  }
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { text: before + inner + after, start, end: start + inner.length };
  }

  return {
    text: before + marker + selected + marker + after,
    start: start + m,
    end: end + m,
  };
}

const CHECKED_PREFIX = /^(\s*)- \[[ xX]\] /;
const QUOTE_PREFIX = /^(\s*)> /;

/**
 * Toggle a line prefix ("- [ ] " checklist, "> " quote) across every line the
 * selection touches. If all touched lines already carry it, it is removed;
 * otherwise it is added where missing. Selection stretches with the edit.
 */
export function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  kind: "checklist" | "quote",
): TextSelection {
  const prefix = kind === "checklist" ? "- [ ] " : "> ";
  const matcher = kind === "checklist" ? CHECKED_PREFIX : QUOTE_PREFIX;

  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allPrefixed = lines.every((l) => matcher.test(l) || l.trim() === "");

  let startShift = 0;
  let totalShift = 0;
  const nextLines = lines.map((l, i) => {
    let next = l;
    if (allPrefixed) {
      next = l.replace(matcher, "$1");
    } else if (!matcher.test(l)) {
      const indent = l.match(/^\s*/)?.[0] ?? "";
      next = indent + prefix + l.slice(indent.length);
    }
    const shift = next.length - l.length;
    if (i === 0) startShift = shift;
    totalShift += shift;
    return next;
  });

  return {
    text: text.slice(0, lineStart) + nextLines.join("\n") + text.slice(lineEnd),
    start: Math.max(lineStart, start + startShift),
    end: Math.max(lineStart, end + totalShift),
  };
}

const LIST_LINE = /^(\s*)(- \[[ xX]\] |- |\* |> )(.*)$/;

/**
 * Enter-key continuation for lists/quotes/checklists: pressing Enter on a
 * "- [ ] foo" line starts the next line with "- [ ] " (checkboxes always reset
 * to unchecked); Enter on an EMPTY item clears the marker instead — the
 * standard type-to-exit gesture. Returns null when the caret isn't on a
 * continuable line (caller falls through to a plain newline).
 */
export function continueListOnEnter(text: string, caret: number): TextSelection | null {
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const lineEndRaw = text.indexOf("\n", caret);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);
  const m = line.match(LIST_LINE);
  if (!m) return null;

  const [, indent, markerRaw, rest] = m;
  // New checklist items always start unchecked.
  const marker = markerRaw.startsWith("- [") ? "- [ ] " : markerRaw;

  if (rest.trim() === "") {
    // Empty item + Enter → drop the marker and leave a plain line.
    const newCaret = lineStart + indent.length;
    return { text: text.slice(0, lineStart) + indent + text.slice(lineEnd), start: newCaret, end: newCaret };
  }

  const inserted = `\n${indent}${marker}`;
  const newCaret = caret + inserted.length;
  return { text: text.slice(0, caret) + inserted + text.slice(caret), start: newCaret, end: newCaret };
}
