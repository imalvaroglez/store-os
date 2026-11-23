import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Button";

// #530 — the text-only contextual help DESIGN.md §«Acciones, ayuda y
// movimiento» prescribes: shown near its origin by pointer (after a brief
// pause) and by keyboard focus, closed by Esc while the trigger keeps the
// focus, and toggled by touch without running any other action. The panel is
// absolutely positioned so opening it never shifts fields or buttons.
const SHOW_DELAY_MS = 400;
// #530 QA r2 (mayor 3): the balloon needs its own height free beside the
// trigger; otherwise it flips UP (Dropdown/Sheet rule).
const MIN_PANEL_SPACE = 150;

/** #530 QA r2: flip the balloon up when there is no room below the trigger —
 * pure so the decision is unit-testable (jsdom has no layout). */
export function shouldFlipUp(
  triggerTop: number,
  triggerBottom: number,
  bounds: { top: number; bottom: number },
  minSpace = MIN_PANEL_SPACE,
): boolean {
  const below = bounds.bottom - triggerBottom;
  const above = triggerTop - bounds.top;
  return below < minSpace && above >= minSpace;
}

/** #530 QA r3 (mayor): the edge that clips the balloon is the nearest
 * vertical scroll container — a floating Sheet's `overflow-y-auto` panel —
 * not the viewport. `body`/`html` overflow propagates to the viewport, so the
 * walk stops there and falls back to the viewport bounds. Pure DOM walk, no
 * layout of its own. */
export function clippingBounds(el: HTMLElement | null): { top: number; bottom: number } {
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      const port = node.getBoundingClientRect();
      return { top: port.top, bottom: port.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

type Props = {
  /** Accessible name of the help trigger, e.g. "Ayuda: imprimir y guardar PDF". */
  label: string;
  /** The clarification itself — plain text, no interactive content. */
  children: ReactNode;
};

export function HelpTip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const showTimer = useRef<number | null>(null);
  // #530 QA r2 (mayores 1–2): the touch pipeline differs from the mouse one.
  // Chromium emits a SYNTHETIC mouseout/mouseleave right after a tap's click
  // (the QA trace's TOOLTIP REMOVE @44ms) — mouse enter/leave must be ignored
  // while the last pointer was touch. And on touch the FOCUS arrives when the
  // finger lifts, so the gesture is stamped on pointerdown AND pointerup (a
  // >500ms hold must not turn the release click into a close).
  const lastPointerType = useRef("");
  const gestureAt = useRef(0);
  const openedByPointerGesture = useRef(false);
  const POINTER_FOCUS_WINDOW_MS = 500;

  const clearTimer = () => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  };
  useEffect(() => clearTimer, []);
  // #530 QA r3 (menor 4): the flip is geometry, and the geometry changes when
  // the clipping scrollport scrolls — re-decide while open so the balloon
  // stays inside it. Capture-phase `scroll` catches any ancestor container.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recomputeFlip, true);
    return () => window.removeEventListener("scroll", recomputeFlip, true);
  }, [open]);

  const stampPointer = (pointerType: string) => {
    lastPointerType.current = pointerType;
    gestureAt.current = Date.now();
  };
  const isTouch = () => lastPointerType.current === "touch" || lastPointerType.current === "pen"; // QA r3 menor 1: stylus taps emit the same synthetic mouseout as touch

  const recomputeFlip = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setFlipUp(rect ? shouldFlipUp(rect.top, rect.bottom, clippingBounds(wrapRef.current)) : false);
  };
  const show = () => {
    clearTimer();
    recomputeFlip();
    setOpen(true);
  };
  const showByFocus = () => {
    if (Date.now() - gestureAt.current < POINTER_FOCUS_WINDOW_MS) openedByPointerGesture.current = true;
    show();
  };
  const hide = () => {
    clearTimer();
    setOpen(false);
  };
  const scheduleShow = () => {
    if (open || showTimer.current !== null) return;
    showTimer.current = window.setTimeout(show, SHOW_DELAY_MS);
  };
  const toggle = () => {
    if (open && openedByPointerGesture.current) {
      openedByPointerGesture.current = false; // the click of the SAME gesture: intent to open
      return;
    }
    open ? hide() : show();
  };

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <IconButton
        variant="ghost"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onFocus={showByFocus}
        onBlur={hide}
        onPointerDown={(event) => {
          stampPointer(event.pointerType);
          // A new press resets the gesture mark: the second tap's click must
          // toggle (no focus event refires on an already-focused trigger).
          openedByPointerGesture.current = false;
        }}
        onPointerUp={(event) => stampPointer(event.pointerType)}
        onMouseEnter={() => {
          if (isTouch()) return; // synthetic after a tap — not a real hover
          scheduleShow();
        }}
        onMouseLeave={() => {
          if (isTouch()) return;
          hide();
        }}
        onClick={toggle}
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
          className={`absolute right-0 z-30 block w-64 rounded-xl border border-edge bg-surface p-3 text-left text-sm font-normal normal-case tracking-normal text-on-surface shadow-lift ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
