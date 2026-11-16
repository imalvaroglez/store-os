// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("./navItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./navItems")>();
  return { ...actual, navigate: mocks.navigate };
});

// #454 — la barra lateral es el contrato de arquitectura de información:
// cuatro áreas exactas, Gastos sin funciones ajenas y el grupo de la ruta
// activa abierto tras un deep-link.
describe("Sidebar áreas (#454)", () => {
  it("renderiza las cuatro áreas en orden con sus hojas; Inicio fuera de grupos", () => {
    render(<Sidebar active="inicio" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    const groups = ["Ventas", "Inventario y catálogo", "Compras y abastecimiento", "Administración"];
    for (const label of groups) expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inicio" })).toBeTruthy();
  });

  it("deep-link a Cierre mensual: Administración nace ABIERTA y las demás cerradas", () => {
    render(<Sidebar active="productos_cierre" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    // La hoja activa es visible sin tocar nada…
    expect(screen.getByRole("button", { name: "Cierre mensual" })).toBeTruthy();
    // …y las hojas de las áreas cerradas no se renderizan.
    expect(screen.queryByRole("button", { name: "Pedidos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compras" })).toBeNull();
  });

  it("expandir/contraer funciona por área con aria-expanded; el grupo NO navega", () => {
    render(<Sidebar active="inicio" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    const ventas = screen.getByRole("button", { name: /Ventas/ });
    expect(ventas.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(ventas);
    expect(ventas.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Top emprendedoras" })).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/pedidos");
  });

  it("las hojas navegan a su ruta y la activa lleva aria-current", () => {
    render(<Sidebar active="productos_ranking" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    const ranking = screen.getByRole("button", { name: "Top emprendedoras" });
    expect(ranking.getAttribute("aria-current")).toBe("page");
    fireEvent.click(ranking);
    expect(mocks.navigate).toHaveBeenCalledWith("/productos/ranking");
  });

  it("Gastos es una hoja de Administración, no un índice: sin ranking ni compras en el grupo", () => {
    render(<Sidebar active="productos_gastos" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Gastos" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Top emprendedoras" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compras" })).toBeNull();
  });

  it("Usuarios (sólo super_admin) vive en el pie junto a Opciones, fuera de las áreas", () => {
    render(<Sidebar active="inicio" storeType="inventory_tiered" userRole="super_admin" onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Usuarios" })).toBeTruthy();
    cleanup();
    render(<Sidebar active="inicio" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Usuarios" })).toBeNull();
  });
});

describe("#454 r2 — devoluciones", () => {
  it("navegación in-session (cambio de ruta) abre el área destino como un refresh", () => {
    const { rerender } = render(<Sidebar active="inicio" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Pedidos" })).toBeNull();
    rerender(<Sidebar active="pedidos" storeType="inventory_tiered" onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Pedidos" })).toBeTruthy();
  });
});
