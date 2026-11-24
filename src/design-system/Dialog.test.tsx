// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

// #539: a confirm that only answers once the dialog settles starts DISABLED.
// The browser skips a disabled control, so the trap must not count it as the
// last stop — with it counted, Tab from «Cancelar» was not intercepted and the
// focus escaped behind the overlay.
describe("Dialog · trampa de foco con controles deshabilitados (#539)", () => {
  function mountWithDisabledConfirm() {
    render(
      <>
        <button>Detrás del diálogo</button>
        <Dialog
          open
          title="¿Preparar este pedido?"
          onClose={() => {}}
          footer={
            <>
              <Button size="sm" variant="secondary">Cancelar</Button>
              <Button size="sm" disabled>Preparar pedido</Button>
            </>
          }
        >
          <p>Contenido</p>
        </Dialog>
      </>
    );
    return screen.getByRole("button", { name: "Cancelar" });
  }

  it("el foco inicial cae en el primer control utilizable (Cancelar)", () => {
    const cancelar = mountWithDisabledConfirm();
    expect(document.activeElement).toBe(cancelar);
  });

  it("Tab desde el último control utilizable se intercepta: el deshabilitado no cuenta como parada", () => {
    const cancelar = mountWithDisabledConfirm();
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true); // da la vuelta: no hay a dónde ir
    expect(document.activeElement).toBe(cancelar);
  });
});
