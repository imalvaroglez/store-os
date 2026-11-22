// @vitest-environment jsdom
// #530 — DESIGN.md documents a text-only help tooltip of the design system
// that did not exist. This is its contract: pointer (with a brief pause),
// keyboard focus, Esc closes without stealing focus, touch toggles, and the
// panel never shifts surrounding fields or buttons.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HelpTip, shouldFlipUp } from "./HelpTip";

describe("HelpTip · ayuda contextual accesible (#530)", () => {
  it("el disparador tiene nombre accesible y la aclaración nace oculta", () => {
    render(
      <HelpTip label="Ayuda: imprimir y guardar PDF">
        En el diálogo de impresión, elige «Guardar como PDF» como destino.
      </HelpTip>
    );
    expect(screen.getByRole("button", { name: /imprimir y guardar pdf/i })).toBeTruthy();
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
  });

  it("teclado: el foco abre la aclaración y Esc la cierra sin robar el foco", () => {
    render(
      <HelpTip label="Ayuda: imprimir y guardar PDF">
        En el diálogo de impresión, elige «Guardar como PDF» como destino.
      </HelpTip>
    );
    const trigger = screen.getByRole("button", { name: /imprimir y guardar pdf/i });
    // Real focus (fireEvent.focus does not move document.activeElement in jsdom).
    act(() => trigger.focus());
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
    // #530: Esc conserves the focus on the trigger — the control keeps it.
    expect(trigger).toHaveFocus();
  });

  it("Esc de la ayuda NO cierra el Sheet/Dialog contenedor (el más interno responde)", () => {
    const onSheetClose = vi.fn();
    render(
      <div onKeyDown={onSheetClose}>
        <HelpTip label="Ayuda: imprimir y guardar PDF">
          En el diálogo de impresión, elige «Guardar como PDF» como destino.
        </HelpTip>
      </div>
    );
    const trigger = screen.getByRole("button", { name: /imprimir y guardar pdf/i });
    fireEvent.focus(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onSheetClose).not.toHaveBeenCalled();
  });

  it("puntero: la aclaración aparece tras una pausa breve y se va con el puntero", () => {
    vi.useFakeTimers();
    render(
      <HelpTip label="Ayuda: imprimir y guardar PDF">
        En el diálogo de impresión, elige «Guardar como PDF» como destino.
      </HelpTip>
    );
    const trigger = screen.getByRole("button", { name: /imprimir y guardar pdf/i });
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull(); // brief pause first
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
  });

  it("toque: tocar el disparador alterna la aclaración; es su propio control, sin acción ajena", () => {
    render(
      <HelpTip label="Ayuda: imprimir y guardar PDF">
        En el diálogo de impresión, elige «Guardar como PDF» como destino.
      </HelpTip>
    );
    const trigger = screen.getByRole("button", { name: /imprimir y guardar pdf/i });
    fireEvent.click(trigger);
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
  });

  it("gesto Chrome/Firefox: el click inmediatamente después del foco NO vuelve a cerrar (dictamen QA #530)", () => {
    render(
      <HelpTip label="Ayuda: imprimir y guardar PDF">
        En el diálogo de impresión, elige «Guardar como PDF» como destino.
      </HelpTip>
    );
    const trigger = screen.getByRole("button", { name: /imprimir y guardar pdf/i });
    // Real event order on tap/click in Chrome/Firefox: pointerdown → focus → click.
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    fireEvent.click(trigger); // the click of the SAME gesture — consumed, stays open
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    // A SECOND tap re-presses the already focused trigger: no new focus event,
    // so the click toggles and closes.
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
  });

  it("blur cierra la aclaración y aria-expanded/describedby reflejan el estado", () => {
    render(
      <HelpTip label="Ayuda: imprimir y guardar PDF">
        En el diálogo de impresión, elige «Guardar como PDF» como destino.
      </HelpTip>
    );
    const trigger = screen.getByRole("button", { name: /imprimir y guardar pdf/i }) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // QA #530 (menor): describedby only while the panel exists in the DOM.
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    fireEvent.focus(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.blur(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.useRealTimers();
  });
});

// --- Dictamen QA r2 (22-nov): the three Chromium-touch blockers ----------
describe("HelpTip · vía táctil Chromium (dictamen QA r2)", () => {
  const TIP = "En el diálogo de impresión, elige «Guardar como PDF» como destino.";
  function tip() {
    render(<HelpTip label="Ayuda: imprimir y guardar PDF">{TIP}</HelpTip>);
    return screen.getByRole("button", { name: /imprimir y guardar pdf/i });
  }
  // The REAL Chromium tap sequence. `withFocus` models that a re-press of an
  // already-focused trigger fires NO new focus event (second tap).
  const tap = (el: HTMLElement, withFocus = true) => {
    fireEvent.pointerDown(el, { pointerType: "touch" });
    fireEvent.pointerUp(el, { pointerType: "touch" });
    if (withFocus) fireEvent.focus(el);
    fireEvent.click(el);
  };

  it("traza real del tap de Chromium: el mouseleave SINTÉTICO tras el clic no cierra la aclaración", () => {
    const trigger = tip();
    tap(trigger);
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    // Chromium emits synthetic mouseout/mouseleave right after the tap's
    // click — the QA trace's TOOLTIP REMOVE @44ms. Touch input ignores them.
    fireEvent.mouseOut(trigger, { bubbles: true });
    fireEvent.mouseLeave(trigger);
    expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
    // The SECOND tap re-presses the focused trigger: no focus event, closes.
    tap(trigger, false);
    expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
  });

  it("presión mantenida ~700 ms: el foco llega al LEVANTAR — la aclaración queda visible", () => {
    vi.useFakeTimers();
    try {
      const trigger = tip();
      fireEvent.pointerDown(trigger, { pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(700);
      });
      fireEvent.pointerUp(trigger, { pointerType: "touch" });
      fireEvent.focus(trigger); // touch focus fires on release
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
      fireEvent.click(trigger);
      expect(screen.getByText(/guardar como pdf/i)).toBeTruthy(); // consumed, stays open
    } finally {
      vi.useRealTimers();
    }
  });

  it("mouse REAL conserva su semántica: enter abre tras la pausa y leave cierra", () => {
    vi.useFakeTimers();
    try {
      const trigger = tip();
      fireEvent.pointerDown(trigger, { pointerType: "mouse" });
      fireEvent.pointerUp(trigger, { pointerType: "mouse" });
      fireEvent.mouseEnter(trigger);
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(screen.getByText(/guardar como pdf/i)).toBeTruthy();
      fireEvent.mouseLeave(trigger);
      expect(screen.queryByText(/guardar como pdf/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Placement (dictamen r2, tercer mayor): the balloon flips UP when there is
// no room below the trigger — pure, layout-independent decision.
describe("shouldFlipUp · colocación del globo (dictamen QA r2)", () => {
  it("con espacio abajo no voltea; pegado al borde inferior voltea; sin espacio arriba tampoco", () => {
    expect(shouldFlipUp(620, 660, 844)).toBe(false); // 184px below: room
    expect(shouldFlipUp(700, 740, 844)).toBe(true); // 104px below: less than the panel needs
    expect(shouldFlipUp(800, 840, 844)).toBe(true); // 4px below: flip up (top 800 ≥ min)
    expect(shouldFlipUp(40, 80, 844)).toBe(false); // near bottom BUT no room above either
  });
});
