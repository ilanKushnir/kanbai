import sanitizeHtml from "sanitize-html";

// Allowlist for ticket descriptions: just the formatting the editor can produce.
const OPTS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "h3", "h4", "blockquote", "a", "span", "div"],
  allowedAttributes: { a: ["href", "target", "rel"], "*": ["style"] },
  // style is permitted but filtered down to text-align only — no urls/expressions.
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
    }),
  },
};

function looksLikeHtml(s: string) {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Normalize a ticket description into SAFE HTML for storage + rendering.
 * - Rich HTML (from the editor) → sanitized against the allowlist (strips scripts,
 *   event handlers, unsafe attrs/urls).
 * - Plain text (agent input, notes) → escaped and turned into paragraphs/line breaks.
 */
export function toRichHtml(input: string | null | undefined): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  if (looksLikeHtml(s)) return sanitizeHtml(s, OPTS).trim();
  return s
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeText(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
