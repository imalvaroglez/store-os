import { useEffect, useRef, type ReactNode } from "react";

// Centered confirmation dialog. Manual focus trap (Tab/Shift+Tab kept inside),
// initial focus to first focusable, focus restore on close. Reuses the Sheet
// ESC + body-scroll-lock pattern.
export function Dialog({
  open,
  title,
  tone,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  tone?: "danger";
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  // onClose lives in a ref so inline (unstable) handlers don't tear the effect
  // down on every parent render — focus restore and scroll lock stay solid.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    const focusables = () =>
      panel?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [];

    const first = focusables()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      lastFocused.current?.focus();
    };
    // Only `open` in deps: onClose is read through onCloseRef, so re-renders
    // while open (typing in the form) never re-run the trap.
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center p-4"
      style={{ animation: "dialogIn var(--motion-fast) var(--ease-smooth)" }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-paper rounded-sheet w-full max-w-sm shadow-lift p-5"
        style={{ animation: "dialogPop var(--motion-base) var(--ease-spring)" }}
      >
        <h2 className={`serif-display text-xl font-semibold mb-2 ${tone === "danger" ? "text-danger" : "text-ink"}`}>
          {title}
        </h2>
        <div className="text-ink-soft text-sm mb-5">{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
