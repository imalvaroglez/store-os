import { navigate } from "../lib/router";
import type { StoreType } from "../types";

// Nav tabs. "productos" is a parent whose default route IS the product list
// (no /productos/productos); it expands into Categorías / Compras children.
// "Compras" only exists for inventory-tiered stores (inherits the filter the
// old Inventario tab had).
export type Tab =
  | "inicio"
  | "productos"
  | "productos_categorias"
  | "productos_compras"
  | "productos_gastos"
  | "productos_empaques"
  | "productos_reglas"
  | "productos_estrategia"
  | "productos_reparto"
  | "pedidos"
  | "clientes"
  | "usuarios"
  | "tienda";

export type PlatformRole = "super_admin" | "member";

export type NavItem = { id: Tab; label: string; path: string; children?: NavItem[] };

// Single source of truth for admin navigation. Shared by BottomNav (mobile)
// and Sidebar (desktop) so the two never drift.
export const NAV_ITEMS: NavItem[] = [
  { id: "inicio", label: "Inicio", path: "/" },
  {
    id: "productos",
    label: "Productos",
    path: "/productos",
    children: [
      { id: "productos_categorias", label: "Categorías", path: "/productos/categorias" },
      { id: "productos_compras", label: "Compras", path: "/productos/compras" },
      { id: "productos_gastos", label: "Gastos", path: "/productos/gastos" },
      { id: "productos_empaques", label: "Empaques", path: "/productos/empaques" },
      { id: "productos_reglas", label: "Reglas de venta", path: "/productos/reglas" },
      { id: "productos_estrategia", label: "Estrategia de precios", path: "/productos/estrategia" },
    ],
  },
  { id: "pedidos", label: "Pedidos", path: "/pedidos" },
  { id: "clientes", label: "Clientes", path: "/clientes" },
  { id: "usuarios", label: "Usuarios", path: "/usuarios" },
];

// The productos parent is highlighted when itself or any of its children is active.
export function parentActive(active: Tab): boolean {
  return active === "productos" || active.startsWith("productos_");
}

// Compras child only exists for inventory-tiered stores; so do the level
// pricing rules and the per-category strategy (levels only exist for tiered
// stores).
export function visibleNavItems(storeType: StoreType, userRole?: PlatformRole) {
  return NAV_ITEMS.filter((item) => item.id !== "usuarios" || userRole === "super_admin").map((t) =>
    t.children
      ? {
          ...t,
          children: t.children.filter(
            (c) =>
              (c.id !== "productos_compras" || storeType === "inventory_tiered") &&
              (c.id !== "productos_reglas" || storeType === "inventory_tiered") &&
              (c.id !== "productos_estrategia" || storeType === "inventory_tiered")
          ),
        }
      : t
  );
}

export { navigate };
