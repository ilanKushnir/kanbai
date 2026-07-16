import { cn } from "@/lib/utils";

/**
 * Render a ticket description's HTML. The value is sanitized server-side on write
 * (see lib/sanitize.ts), so it is safe to inject here.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  // dir="auto": RTL-first descriptions (Hebrew/Arabic) read right-to-left.
  return <div dir="auto" className={cn("rich", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
