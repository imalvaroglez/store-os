// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("./navItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./navItems")>();
  return { ...actual, navigate: mocks.navigate };
});

// #325: the mobile nav's ▾ toggle — behavior and the right-anchored 44×44 hit
// area (a centered box overlapped the neighboring tab at 390px; right-anchored
// it stays inside its own tab).
describe("BottomNav áreas (#454 / #325)", () => {
  it("un botón por área alterna el menú hacia arriba sin navegar", () => {
    render(<BottomNav active="pedidos" storeType="inventory_tiered" />);
    const ventas = screen.getByRole("button", { name: "Ventas" });
    expect(ventas.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(ventas);
    expect(ventas.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(ventas);
    expect(ventas.getAttribute("aria-expanded")).toBe("false");
  });

  it("el destino se alcanza tocando el área y luego la hoja (≤2 interacciones)", () => {
    render(<BottomNav active="inicio" storeType="inventory_tiered" />);
    fireEvent.click(screen.getByRole("button", { name: "Administración" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cierre mensual" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/productos/cierre");
  });

  it("sin chevrón separado: el botón del área ES el objetivo táctil (≥ altura de fila completa)", () => {
    // #325 eliminó un chevrón de 14px con área extendida; con un solo botón
    // por área, el objetivo es el propio botón (fila py-3) — no existe el
    // control diminuto que invadía vecinos.
    render(<BottomNav active="inicio" storeType="inventory_tiered" />);
    expect(screen.queryByRole("button", { name: "Expandir" })).toBeNull();
    const admin = screen.getByRole("button", { name: "Administración" });
    expect(admin.className).toContain("py-3");
  });
});

describe("#454 r2 — menú anclado a la barra (no a la pestaña)", () => {
  it("el menú abierto usa inset-x (ancho completo de la barra), jamás w-44 centrado en la pestaña", () => {
    render(<BottomNav active="inicio" storeType="inventory_tiered" />);
    fireEvent.click(screen.getByRole("button", { name: "Administración" }));
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("inset-x-2");
    expect(menu.className).not.toContain("w-44");
    expect(menu.className).not.toContain("left-1/2");
  });
});
