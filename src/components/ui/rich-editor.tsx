"use client";

import * as React from "react";
import {
  Bold,
  Italic,
  Underline,
  Heading,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Normalize a user-typed URL to a safe, schemed absolute URL. */
function normalizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  return `https://${url.replace(/^\/+/, "")}`;
}

type Tool = { icon: React.ComponentType<{ className?: string }>; cmd: string; arg?: string; label: string };

const TOOLS: Tool[] = [
  { icon: Bold, cmd: "bold", label: "Bold" },
  { icon: Italic, cmd: "italic", label: "Italic" },
  { icon: Underline, cmd: "underline", label: "Underline" },
  { icon: Heading, cmd: "formatBlock", arg: "<h3>", label: "Title" },
  { icon: List, cmd: "insertUnorderedList", label: "Bulleted list" },
  { icon: ListOrdered, cmd: "insertOrderedList", label: "Numbered list" },
  { icon: AlignLeft, cmd: "justifyLeft", label: "Align left" },
  { icon: AlignCenter, cmd: "justifyCenter", label: "Align center" },
  { icon: AlignRight, cmd: "justifyRight", label: "Align right" },
];

/**
 * A lightweight rich-text editor (contentEditable + execCommand) for ticket
 * descriptions. Output HTML is sanitized server-side on save. Toolbar buttons
 * use onMouseDown→preventDefault so the editor keeps focus/selection.
 */
export function RichEditor({
  value,
  onSave,
  onCancel,
  saving,
}: {
  value: string;
  onSave: (html: string) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = value || "";
    el.focus();
    // Put the caret at the end.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(cmd: string, arg?: string) {
    // execCommand is deprecated but universally supported and ideal for a simple editor.
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
  }

  function addLink() {
    const sel = window.getSelection();
    const selected = sel ? sel.toString() : "";
    const url = normalizeUrl(window.prompt("Link URL", "https://") || "");
    if (!url) {
      ref.current?.focus();
      return;
    }
    if (selected) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    }
    ref.current?.focus();
  }

  function isEmpty(el: HTMLDivElement) {
    return el.textContent?.trim() === "" && !el.querySelector("img, hr");
  }

  return (
    <div className="overflow-hidden rounded-xl border border-primary bg-surface ring-2 ring-primary/20">
      <div className="flex flex-wrap items-center gap-0.5 overflow-x-auto border-b border-border bg-surface-2/50 p-1">
        {TOOLS.map((t, i) => (
          <React.Fragment key={t.label}>
            {(i === 3 || i === 6) && <span className="mx-0.5 h-5 w-px bg-border" />}
            <button
              type="button"
              title={t.label}
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(t.cmd, t.arg)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
            >
              <t.icon className="h-4 w-4" />
            </button>
          </React.Fragment>
        ))}
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          title="Add link"
          aria-label="Add link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLink}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
        >
          <Link2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Remove link"
          aria-label="Remove link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("unlink")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
        >
          <Unlink className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={ref}
        dir="auto"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Add a description…"
        className="rich max-h-[50vh] min-h-[7rem] overflow-y-auto px-3 py-2.5 text-sm outline-none"
      />
      <div className="flex justify-end gap-2 border-t border-border p-2">
        <Button variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSave(ref.current && !isEmpty(ref.current) ? ref.current.innerHTML : "")}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
