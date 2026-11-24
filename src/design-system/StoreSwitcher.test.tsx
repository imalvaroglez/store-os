// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreSwitcher } from "./StoreSwitcher";
import type { Store } from "../types";

// #543 — the switcher's menu must close from OUTSIDE its own bar and with
// Escape. Its click catcher used to be a `fixed inset-0` div, but both rails
// that host this switcher carry a backdrop-filter, which makes them the
// containing block of a fixed descendant: the catcher shrank to the bar,
// swallowed every control in it and refused outside clicks.
const store = (id: string, name: string) => ({ id, name, type: "inventory_tiered" }) as Store;
const joyeria = store("s1", "Joyería");
const boutique = store("s2", "Boutique");

function mountOpen(onSelect = vi.fn()) {
  render(<StoreSwitcher stores={[joyeria, boutique]} activeStore={joyeria} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /Joyería/ }));
  expect(screen.getByRole("button", { name: /Boutique/ })).toBeTruthy();
  return onSelect;
}

afterEach(() => document.body.replaceChildren());

describe("StoreSwitcher · cierre del menú (#543)", () => {
  it("abrir el menú no deja una trampa de clics a pantalla completa", () => {
    mountOpen();
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
  });

  it("una pulsación fuera del conmutador cierra el menú", () => {
    mountOpen();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: /Boutique/ })).toBeNull();
  });

  it("Escape cierra el menú", () => {
    mountOpen();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /Boutique/ })).toBeNull();
  });

  it("una pulsación dentro del conmutador no lo cierra", () => {
    mountOpen();
    fireEvent.mouseDown(screen.getByRole("button", { name: /Boutique/ }));
    expect(screen.getByRole("button", { name: /Boutique/ })).toBeTruthy();
  });

  it("elegir una tienda la selecciona y cierra el menú", () => {
    const onSelect = mountOpen();
    fireEvent.click(screen.getByRole("button", { name: /Boutique/ }));
    expect(onSelect).toHaveBeenCalledWith("s2");
    expect(screen.queryByRole("button", { name: /Boutique/ })).toBeNull();
  });
});
