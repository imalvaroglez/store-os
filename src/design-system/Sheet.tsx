import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Button";

// Bottom-sheet modal. Mobile-first, ESC + backdrop dismissible.
// Replaces the raw close <button> with IconButton.
export function Sheet({
  open,
  onClose,
  title,
  children,
  className = "",
  contentClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  // onClose in a ref: inline (unstable) handlers must not re-run the scroll
  // lock / key listener on every parent render while the sheet is open.
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center p-0 md:p-4">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px] animate-[fadeIn_var(--motion-fast)_var(--ease-smooth)]" onClick={onClose} aria-hidden />
      {/* grab handle — mobile only */}
      <div className="md:hidden relative mx-auto mb-[-8px] h-1.5 w-10 rounded-full bg-stone-300/80 z-10" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative bg-paper rounded-t-sheet md:rounded-sheet w-full md:w-[min(90vw,64rem)] md:max-w-5xl max-h-[92vh] overflow-y-auto shadow-lift ${className}`}
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          animation: `slideUp var(--motion-base) var(--ease-smooth)`,
        }}
      >
        <div className="sticky top-0 bg-paper/95 backdrop-blur px-5 pt-4 pb-3 flex items-center justify-between border-b border-rule/70">
          <h2 className="serif-display text-xl font-semibold text-ink">{title}</h2>
          <IconButton variant="ghost" aria-label="Cerrar" onClick={onClose} className="text-2xl">
            ×
          </IconButton>
        </div>
        <div className={`px-5 pb-6 pt-3 ${contentClassName}`}>{children}</div>
      </div>
    </div>
  );
}

// Kills the repeated `creating`/`editing` useState + two <Sheet> boilerplate in
// every CRUD screen. Drives a single sheet that handles both create and edit.
export function useEntitySheet<T>() {
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState<T | null>(null);
  const [mode, setMode] = useState<"create" | "edit" | null>(null);

  function openCreate(fresh: T) {
    setEntity(fresh);
    setMode("create");
    setOpen(true);
  }
  function openEdit(existing: T) {
    setEntity(existing);
    setMode("edit");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setEntity(null);
    setMode(null);
  }

  return {
    open,
    entity,
    isOpen: open,
    mode,
    openCreate,
    openEdit,
    close,
  };
}
