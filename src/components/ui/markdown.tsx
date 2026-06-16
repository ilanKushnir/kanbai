"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Flip the index-th GFM task checkbox in raw markdown text. */
export function toggleTask(raw: string, index: number): string {
  let i = -1;
  return raw.replace(/([-*+]|\d+\.)\s+\[( |x|X)\]/g, (m, bullet, mark) => {
    i++;
    if (i !== index) return m;
    return `${bullet} [${mark === " " ? "x" : " "}]`;
  });
}

export function Markdown({
  content,
  className,
  onToggleCheckbox,
}: {
  content: string;
  className?: string;
  onToggleCheckbox?: (index: number) => void;
}) {
  // Index checkboxes in document order so toggles map back to the raw text.
  const counter = React.useRef(-1);
  counter.current = -1;

  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          input: (props) => {
            if (props.type === "checkbox") {
              const idx = ++counter.current;
              return (
                <input
                  type="checkbox"
                  className="md-check"
                  checked={!!props.checked}
                  disabled={!onToggleCheckbox}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleCheckbox?.(idx)}
                />
              );
            }
            // eslint-disable-next-line jsx-a11y/no-redundant-roles
            return <input {...props} />;
          },
          a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
