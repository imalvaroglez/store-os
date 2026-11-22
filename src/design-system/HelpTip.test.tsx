// @vitest-environment jsdom
// #530 — DESIGN.md documents a text-only help tooltip of the design system
// that did not exist. This is its contract: pointer (with a brief pause),
// keyboard focus, Esc closes without stealing focus, touch toggles, and the
// panel never shifts surrounding fields or buttons.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HelpTip } from "./HelpTip";

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
