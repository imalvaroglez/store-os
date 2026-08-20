import { describe, expect, it } from "vitest";
import { redirectPath } from "./router";

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
