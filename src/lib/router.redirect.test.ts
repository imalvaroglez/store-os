import { describe, expect, it } from "vitest";
import { matchRoute, redirectPath } from "./router";

// Legacy admin URLs must land inside the unified Productos nav
// (unified-products spec, criterion 9).
describe("redirectPath (legacy admin URLs)", () => {
  it("redirects the old catalog parent and its productos child to the list", () => {
    expect(redirectPath("catalogo-admin", "")).toBe("/productos");
    expect(redirectPath("catalogo-admin", "productos")).toBe("/productos");
  });

  it("redirects old sub-routes to their new home", () => {
    expect(redirectPath("catalogo-admin", "categorias")).toBe("/productos/categorias");
  });

  it("redirects the removed inventario tab to the product list", () => {
    expect(redirectPath("inventario", "")).toBe("/productos");
  });

  it("leaves current and public routes alone", () => {
    expect(redirectPath("productos", "")).toBeNull();
    expect(redirectPath("productos", "categorias")).toBeNull();
    expect(redirectPath("pedidos", "")).toBeNull();
    expect(redirectPath("", "")).toBeNull();
  });
});

describe("order routes", () => {
  it("matches the new and edit routes without losing id punctuation", () => {
    expect(matchRoute("/pedidos/nuevo")).toEqual({ name: "admin", params: { tab: "pedidos", sub: "nuevo" } });
    expect(matchRoute("/pedidos/order_abc-123")).toEqual({ name: "admin", params: { tab: "pedidos", sub: "order_abc-123" } });
  });
});

describe("store management routes", () => {
  it("matches the store management screen", () => {
    expect(matchRoute("/tienda/configuracion")).toEqual({ name: "admin", params: { tab: "tienda", sub: "configuracion" } });
  });
});
