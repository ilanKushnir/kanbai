// Ticket descriptions come in two formats: Markdown (what agents and the
// markdown editor write — stored as-is) and sanitized HTML (older descriptions
// from the rich editor). Pure helpers shared by server and client.

/** True when the value is HTML (has a tag); anything else is Markdown / plain text. */
export function isHtmlDescription(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

const MARKDOWN_HINT = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\//;

/** Does plain text use Markdown syntax (headings, lists, quotes, bold, links)? */
export function looksLikeMarkdown(s: string): boolean {
  return MARKDOWN_HINT.test(s);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Markdown that an older version escaped into `<p>…<br>…</p>` (plain text
 * used to be wrapped that way on write): give back the Markdown source so it
 * renders formatted. Returns null for real rich HTML.
 */
export function unwrapEscapedMarkdown(html: string): string | null {
  const tags = html.match(/<\/?([a-z0-9]+)[^>]*>/gi) ?? [];
  if (!tags.every((t) => /^<\/?(p|br)\s*\/?>$/i.test(t))) return null;
  const text = decodeEntities(
    html
      .replace(/<\/p>\s*<p>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?p>/gi, ""),
  ).trim();
  return looksLikeMarkdown(text) ? text : null;
}

/** Plain-text excerpt of a description in either format (cards, exports). */
export function descriptionToPlainText(s: string): string {
  if (isHtmlDescription(s)) return s;
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s(\[[ xX]\]\s)?|\d+[.)]\s|>\s?)/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
