"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, X, Info, TriangleAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "error" | "info";

type ToastInput = {
  title: string;
  description?: string;
  variant?: Variant;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

const ToastCtx = React.createContext<{
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
} | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = ++counter;
      const item: ToastItem = { id, ...input };
      setToasts((t) => [...t.slice(-3), item]); // cap at ~4 visible
      const duration = input.duration ?? (input.onAction ? 6000 : 4000);
      const tm = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, tm);
      return id;
    },
    [dismiss],
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastCtx.Provider value={{ toast, dismiss }}>
      {children}
      <Toaster toasts={toasts} dismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

function Toaster({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

const ICONS: Record<Variant, React.ReactNode> = {
  default: null,
  success: <Check className="h-4 w-4 text-success" />,
  error: <TriangleAlert className="h-4 w-4 text-danger" />,
  info: <Info className="h-4 w-4 text-primary" />,
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const icon = ICONS[toast.variant ?? "default"];
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-lg animate-toast-in",
      )}
      role="status"
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-fg">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-fg-muted">{toast.description}</p>}
      </div>
      {toast.actionLabel && toast.onAction && (
        <button
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary-soft-fg hover:brightness-95 cursor-pointer"
        >
          <Undo2 className="h-3.5 w-3.5" />
          {toast.actionLabel}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg cursor-pointer"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
