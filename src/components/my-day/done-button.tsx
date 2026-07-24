"use client";

import { useFormStatus } from "react-dom";
import { Check } from "lucide-react";

/**
 * Pending-aware Done button. While the server action runs it celebrates
 * locally — check pop + a small sparkle, and `data-done-celebrating` lets the
 * host card bloom via CSS (see `.kb-done-host` in globals.css). Purely
 * presentational: the item only leaves the list once the action revalidates,
 * so a failed action never fakes success.
 */
export function DoneButton({ disabled, title, className }: { disabled?: boolean; title: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      title={title}
      data-done-celebrating={pending ? "" : undefined}
      className={className}
    >
      {pending ? (
        <span className="relative inline-flex">
          <span aria-hidden className="absolute left-1/2 top-0 h-5 w-8 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--success)_1px,transparent_2px)] animate-confetti-pop" />
          <Check className="h-3.5 w-3.5 animate-check-pop" />
        </span>
      ) : (
        <Check className="h-3.5 w-3.5" />
      )} Done
    </button>
  );
}
