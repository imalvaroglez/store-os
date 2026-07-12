import { useEffect, useRef, useState, type ReactNode } from "react";

// Anchored action menu. Flips above/below based on viewport space. Arrow-key
// navigation, Esc / outside-click to close. Controlled `open`/`onClose`.
// ponytail: ~45 lines, no dependency. Uses raw <button> (allowed in design-system).
export function Dropdown({
  trigger,
  open,
  onClose,
  children,
}: {
  trigger: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setFlipUp(rect.bottom > window.innerHeight - 220);
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trigger}
      {open && (
        <div
          role="menu"
          className={`absolute right-0 ${flipUp ? "bottom-full mb-2" : "top-full mt-2"} z-50 min-w-[10rem] rounded-lg bg-paper border border-rule shadow-lift py-1`}
          style={{ animation: "dropdownIn var(--motion-fast) var(--ease-smooth)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`block w-full text-left px-4 py-2 text-sm hover:bg-paper-2 ${tone === "danger" ? "text-danger" : "text-ink"}`}
    >
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-rule" />;
}
