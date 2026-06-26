import { useEffect, useState, type ReactNode } from "react";
import { IconButton } from "./Button";

// Bottom-sheet modal. Mobile-first, ESC + backdrop dismissible.
// Replaces the raw close <button> with IconButton.
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px] animate-[fadeIn_.15s_ease-out]" onClick={onClose} aria-hidden />
      {/* grab handle */}
      <div className="relative mx-auto mb-[-8px] h-1.5 w-10 rounded-full bg-stone-300/80 z-10" />
      <div
        className="relative bg-paper rounded-t-sheet max-h-[92vh] overflow-y-auto animate-[slideUp_.24s_cubic-bezier(0.22,1,0.36,1)] shadow-lift"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="sticky top-0 bg-paper/95 backdrop-blur px-5 pt-4 pb-3 flex items-center justify-between border-b border-rule/70">
          <h2 className="serif-display text-xl font-semibold text-ink">{title}</h2>
          <IconButton variant="ghost" aria-label="Cerrar" onClick={onClose} className="text-2xl">
            ×
          </IconButton>
        </div>
        <div className="px-5 pb-6 pt-3">{children}</div>
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
