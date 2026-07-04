import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "info";
interface ToastAction { label: string; onClick: () => void; }
interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  action?: ToastAction;
}
interface ToastApi {
  success: (msg: string, opts?: { action?: ToastAction }) => void;
  error: (msg: string, opts?: { action?: ToastAction }) => void;
  info: (msg: string, opts?: { action?: ToastAction }) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const TONE: Record<ToastVariant, string> = {
  success: "bg-success",
  error: "bg-danger",
  info: "bg-paper",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Set<number>>(new Set());

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, opts?: { action?: ToastAction }) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, variant, message, action: opts?.action }].slice(-3));
      const handle = window.setTimeout(() => {
        remove(id);
        timers.current.delete(handle);
      }, 3500);
      timers.current.add(handle);
    },
    [remove]
  );

  // Clear any pending timers on unmount so they never fire on a gone provider.
  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach((h) => clearTimeout(h));
      live.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      info: (m, o) => push("info", m, o),
    }),
    [push]
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 md:items-end pointer-events-none">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const a11y =
    item.variant === "error"
      ? { role: "alert" as const }
      : { role: "status" as const, "aria-live": "polite" as const };
  return (
    <div
      {...a11y}
      className="pointer-events-auto flex items-center gap-3 rounded-lg bg-ink text-paper px-4 py-3 shadow-lift max-w-sm w-full md:w-auto"
      style={{ animation: "toastIn var(--motion-base) var(--ease-spring)" }}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[item.variant]}`} />
      <span className="text-sm flex-1">{item.message}</span>
      {item.action && (
        <button
          onClick={() => {
            const action = item.action;
            if (!action) return;
            action.onClick();
            onClose();
          }}
          className="text-sm font-semibold text-terracotta hover:underline py-2 -my-2 px-1 rounded"
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
