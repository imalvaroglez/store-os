// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchRoute, redirectLegacyAdmin } from "./router";

// Legacy /catalogo-admin/* → /productos/* (unified-products). The redirect
// replaces history and fires popstate; these tests pin the URL mapping.

describe("redirectLegacyAdmin", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("redirects the bare parent to /productos", () => {
    expect(redirectLegacyAdmin("/catalogo-admin")).toBe(true);
    expect(window.location.pathname).toBe("/productos");
  });

  it("collapses the old productos child onto the parent", () => {
    expect(redirectLegacyAdmin("/catalogo-admin/productos")).toBe(true);
    expect(window.location.pathname).toBe("/productos");
  });

  it("keeps the categorias sub-route", () => {
    expect(redirectLegacyAdmin("/catalogo-admin/categorias")).toBe(true);
    expect(window.location.pathname).toBe("/productos/categorias");
  });

  it("does not touch other paths (public catalog included)", () => {
    for (const path of ["/", "/productos", "/catalogo/olivia", "/inventario"]) {
      expect(redirectLegacyAdmin(path)).toBe(false);
      expect(window.location.pathname).toBe("/");
    }
  });

  it("new admin routes resolve to the productos family", () => {
    expect(matchRoute("/productos")).toEqual({ name: "admin", params: { tab: "productos", sub: "" } });
    expect(matchRoute("/productos/categorias")).toEqual({
      name: "admin",
      params: { tab: "productos", sub: "categorias" },
    });
  });
});
