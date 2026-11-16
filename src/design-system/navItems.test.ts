import { describe, expect, it } from "vitest";
import { areaIdForTab, visibleNav } from "./navItems";

// #454 — contrato EXACTO de arquitectura de información (PO, 15-nov-2026):
// cuatro áreas con hijos, orden y copy fijos; Gastos deja de ser cajón de sastre.

describe("#454 áreas de navegación", () => {
  it("cuatro áreas exactas — hijos, orden y textos del contrato (tienda por niveles, member)", () => {
    const nav = visibleNav("inventory_tiered", "member");
    expect(nav.areas.map((a) => a.label)).toEqual([
      "Ventas",
      "Inventario y catálogo",
      "Compras y abastecimiento",
      "Administración",
    ]);
    expect(nav.areas[0].children.map((c) => c.label)).toEqual(["Pedidos", "Clientes", "Top emprendedoras"]);
    expect(nav.areas[1].children.map((c) => c.label)).toEqual([
      "Productos",
      "Categorías",
      "Reglas de venta",
      "Estrategia de precios",
    ]);
    expect(nav.areas[2].children.map((c) => c.label)).toEqual(["Compras", "Empaques"]);
    expect(nav.areas[3].children.map((c) => c.label)).toEqual(["Gastos", "Cierre mensual", "Reparto de utilidades"]);
    // Inicio y Opciones viven FUERA de los grupos.
    expect(nav.flat.map((f) => f.label)).toEqual(["Inicio"]);
  });

  it("las hojas conservan sus rutas vigentes (compatibilidad de bookmarks y enlaces)", () => {
    const nav = visibleNav("inventory_tiered", "member");
    const paths = nav.areas.flatMap((a) => a.children.map((c) => c.path));
    expect(paths).toEqual([
      "/pedidos", "/clientes", "/productos/ranking",
      "/productos", "/productos/categorias", "/productos/reglas", "/productos/estrategia",
      "/productos/compras", "/productos/empaques",
      "/productos/gastos", "/productos/cierre", "/productos/reparto",
    ]);
  });

  it("tienda bajo pedido: sin Compras/Reglas/Estrategia; un área vacía no se renderiza", () => {
    const nav = visibleNav("on_demand", "member");
    expect(nav.areas.map((a) => a.label)).toEqual(["Ventas", "Inventario y catálogo", "Compras y abastecimiento", "Administración"]);
    expect(nav.areas[1].children.map((c) => c.label)).toEqual(["Productos", "Categorías"]);
    expect(nav.areas[2].children.map((c) => c.label)).toEqual(["Empaques"]);
  });

  it("Gastos ya no aloja funciones ajenas: su área no contiene cierre, reparto ajeno, ranking ni compras", () => {
    const nav = visibleNav("inventory_tiered", "member");
    const admin = nav.areas.find((a) => a.label === "Administración")!;
    // Cierre mensual y Reparto de utilidades SÍ viven aquí (son administración);
    // ranking y compras ya no.
    expect(admin.children.map((c) => c.id)).toEqual(["productos_gastos", "productos_cierre", "productos_reparto"]);
  });

  it("área activa por tab — deep-links abren el grupo correcto", () => {
    expect(areaIdForTab("pedidos")).toBe("ventas");
    expect(areaIdForTab("clientes")).toBe("ventas");
    expect(areaIdForTab("productos_ranking")).toBe("ventas");
    expect(areaIdForTab("productos")).toBe("catalogo");
    expect(areaIdForTab("productos_categorias")).toBe("catalogo");
    expect(areaIdForTab("productos_reglas")).toBe("catalogo");
    expect(areaIdForTab("productos_estrategia")).toBe("catalogo");
    expect(areaIdForTab("productos_compras")).toBe("abastecimiento");
    expect(areaIdForTab("productos_empaques")).toBe("abastecimiento");
    expect(areaIdForTab("productos_gastos")).toBe("administracion");
    expect(areaIdForTab("productos_cierre")).toBe("administracion");
    expect(areaIdForTab("productos_reparto")).toBe("administracion");
    expect(areaIdForTab("inicio")).toBeNull();
    expect(areaIdForTab("tienda")).toBeNull();
  });

  it("Usuarios solo a super_admin (ítem plano, fuera de las cuatro áreas)", () => {
    expect(visibleNav("inventory_tiered", "super_admin").flat.some((f) => f.id === "usuarios")).toBe(true);
    expect(visibleNav("on_demand", "super_admin").flat.some((f) => f.id === "usuarios")).toBe(true);
    expect(visibleNav("inventory_tiered", "member").flat.some((f) => f.id === "usuarios")).toBe(false);
    expect(visibleNav("inventory_tiered").flat.some((f) => f.id === "usuarios")).toBe(false);
  });
});
