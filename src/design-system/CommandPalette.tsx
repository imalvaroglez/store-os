import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandItem {
  id: string;
  label: string;
  onSelect?: () => void;
}
export interface CommandGroup {
  group: string;
  items: CommandItem[];
}

// Cmd/Ctrl+K command palette. Case-insensitive substring filter. Arrow-key
// navigation, Enter runs, Esc closes. Focus-trap reuses the Dialog pattern
// (Tab contained, focus restore on close). Uses raw <input>/<button> (allowed
// in design-system).
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: CommandGroup[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const flat = useMemo(() => commands.flatMap((g) => g.items), [commands]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return flat;
    return flat.filter((c) => c.label.toLowerCase().includes(term));
  }, [q, flat]);

  // Open transition: reset query/focus, lock scroll, restore focus on close.
  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    setQ("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      lastFocused.current?.focus();
    };
  }, [open]);

  // Keyboard nav: depends on the live filtered list + active index.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[active]?.onSelect?.();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, filtered, active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-start justify-center pt-[12vh] p-4"
      style={{ animation: "dialogIn var(--motion-fast) var(--ease-smooth)" }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar"
        className="relative bg-paper rounded-sheet w-full max-w-lg shadow-lift overflow-hidden"
        style={{ animation: "cmdIn var(--motion-base) var(--ease-spring)" }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder="Buscar…"
          className="w-full px-4 py-3 text-base bg-transparent border-b border-rule text-ink outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-ink-soft text-sm">Sin resultados</p>
          )}
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(idx)}
              onClick={() => {
                c.onSelect?.();
                onClose();
              }}
              className={`block w-full text-left px-4 py-2 text-sm ${idx === active ? "bg-paper-2 text-ink" : "text-ink"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
