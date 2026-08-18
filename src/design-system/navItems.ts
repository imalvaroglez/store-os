import { navigate } from "../lib/router";
import type { StoreType } from "../types";

// Nav tabs. "productos" is a parent that renders the product list at /productos
// and expands into the Categorías / Compras children (each its own route).
// The other tabs are flat leaves.
export type Tab =
  | "inicio"
  | "productos"
  | "productos_categorias"
  | "productos_compras"
  | "pedidos"
  | "clientes"
  | "inventario";

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
    ],
  },
  { id: "pedidos", label: "Pedidos", path: "/pedidos" },
  { id: "clientes", label: "Clientes", path: "/clientes" },
  { id: "inventario", label: "Inventario", path: "/inventario" },
];

// The productos parent is highlighted when itself or any of its children is active.
export function parentActive(active: Tab): boolean {
  return active === "productos" || active.startsWith("productos_");
}

// Inventario tab and the Compras child only exist for inventory-tiered stores.
export function visibleNavItems(storeType: StoreType) {
  const keep = (item: NavItem) =>
    storeType === "inventory_tiered" ||
    (item.id !== "inventario" && item.id !== "productos_compras");
  return NAV_ITEMS.filter(keep).map((t) => ({ ...t, children: t.children?.filter(keep) }));
}

export { navigate };
