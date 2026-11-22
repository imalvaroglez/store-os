import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Button";

// #530 — the text-only contextual help DESIGN.md §«Acciones, ayuda y
// movimiento» prescribes: shown near its origin by pointer (after a brief
// pause) and by keyboard focus, closed by Esc while the trigger keeps the
// focus, and toggled by touch without running any other action. The panel is
// absolutely positioned so opening it never shifts fields or buttons.
const SHOW_DELAY_MS = 400;

type Props = {
  /** Accessible name of the help trigger, e.g. "Ayuda: imprimir y guardar PDF". */
  label: string;
  /** The clarification itself — plain text, no interactive content. */
  children: ReactNode;
};

export function HelpTip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const showTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const show = () => {
    clearTimer();
    setOpen(true);
  };
  const hide = () => {
    clearTimer();
    setOpen(false);
  };
  const scheduleShow = () => {
    if (open || showTimer.current !== null) return;
    showTimer.current = window.setTimeout(show, SHOW_DELAY_MS);
  };

  return (
    <span className="relative inline-flex">
      <IconButton
        variant="ghost"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={panelId}
        onFocus={show}
        onBlur={hide}
        onMouseEnter={scheduleShow}
        onMouseLeave={hide}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          // The innermost control answers Escape (#530, same rule as Dialog
          // #304): close the help, keep the focus here, and stop the event so
          // an open Sheet/Dialog does not close underneath.
          event.stopPropagation();
          hide();
        }}
      >
        <span aria-hidden="true" className="font-normal">?</span>
      </IconButton>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          className="absolute right-0 top-full z-30 mt-1 block w-64 rounded-xl border border-edge bg-surface p-3 text-left text-sm font-normal normal-case tracking-normal text-on-surface shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
