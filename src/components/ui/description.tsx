"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { RichText } from "@/components/ui/rich-text";
import { isHtmlDescription } from "@/lib/description";

/** A ticket description, formatted: Markdown rendered, legacy rich HTML as-is. */
export function DescriptionView({
  value,
  onToggleCheckbox,
}: {
  value: string;
  onToggleCheckbox?: (index: number) => void;
}) {
  if (isHtmlDescription(value)) return <RichText html={value} />;
  return <Markdown content={value} className="text-sm" onToggleCheckbox={onToggleCheckbox} />;
}

/** Plain Markdown source editing — the formatted view is what you see when not editing. */
export function MarkdownEditor({
  value,
  onSave,
  onCancel,
  saving,
}: {
  value: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to half the viewport.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [draft]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-primary bg-surface ring-2 ring-primary/20">
      <textarea
        ref={ref}
        dir="auto"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave(draft.trim());
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={"Add a description…\n\n## Heading · - list · - [ ] checklist · **bold** · [link](https://…)"}
        className="block min-h-[7rem] w-full resize-none bg-transparent px-3 py-2.5 font-mono text-[0.8125rem] leading-6 text-fg outline-none placeholder:text-fg-subtle"
      />
      <div className="flex items-center justify-between gap-2 border-t border-border p-2">
        <span className="pl-1 text-[0.6875rem] text-fg-subtle">Markdown · ⌘/Ctrl+Enter to save</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => onSave(draft.trim())} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
