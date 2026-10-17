import sanitizeHtml from "sanitize-html";
import { isHtmlDescription, unwrapEscapedMarkdown } from "@/lib/description";

/** The HTML tags allowed in ticket descriptions (also advertised to agents via /api/v1/me). */
export const RICH_TEXT_TAGS = [
  "p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "h3", "h4", "blockquote", "a", "span", "div",
] as const;

// Allowlist for ticket descriptions: just the formatting the editor can produce.
const OPTS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_TAGS],
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

/**
 * Normalize a ticket description for storage and responses:
 * - Markdown / plain text → kept as-is (rendered with react-markdown, which
 *   never renders raw HTML, so no escaping is needed);
 * - Markdown an older version escaped into <p>/<br> → unwrapped back to Markdown;
 * - rich HTML → sanitized against the allowlist.
 */
export function normalizeDescription(input: string | null | undefined): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  if (!isHtmlDescription(s)) return s;
  return unwrapEscapedMarkdown(s) ?? sanitizeHtml(s, OPTS).trim();
}
