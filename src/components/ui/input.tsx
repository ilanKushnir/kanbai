import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9.5 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg",
        "placeholder:text-fg-subtle transition-colors",
        "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg",
      "placeholder:text-fg-subtle transition-colors resize-none leading-relaxed",
      "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-fg-muted mb-1.5", className)}
      {...props}
    />
  );
}
