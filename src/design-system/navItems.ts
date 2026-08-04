import { navigate } from "../lib/router";
import type { StoreType } from "../types";

// Nav tabs. "catalogo" is a parent that expands into the Productos / Categorías
// children (each its own route). The other tabs are flat leaves.
export type Tab =
  | "inicio"
  | "catalogo"
  | "catalogo_productos"
  | "catalogo_categorias"
  | "pedidos"
  | "clientes"
  | "inventario";

export type NavItem = { id: Tab; label: string; path: string; children?: NavItem[] };

// Single source of truth for admin navigation. Shared by BottomNav (mobile)
// and Sidebar (desktop) so the two never drift.
export const NAV_ITEMS: NavItem[] = [
  { id: "inicio", label: "Inicio", path: "/" },
  {
    id: "catalogo",
    label: "Catálogo",
    path: "/catalogo-admin",
    children: [
      { id: "catalogo_productos", label: "Productos", path: "/catalogo-admin/productos" },
      { id: "catalogo_categorias", label: "Categorías", path: "/catalogo-admin/categorias" },
    ],
  },
  { id: "pedidos", label: "Pedidos", path: "/pedidos" },
  { id: "clientes", label: "Clientes", path: "/clientes" },
  { id: "inventario", label: "Inventario", path: "/inventario" },
];

// The catalog parent is highlighted when itself or any of its children is active.
export function parentActive(active: Tab): boolean {
  return active === "catalogo" || active.startsWith("catalogo_");
}

// Inventario tab only exists for inventory-tiered stores.
export function visibleNavItems(storeType: StoreType) {
  return NAV_ITEMS.filter((t) => t.id !== "inventario" || storeType === "inventory_tiered");
}

export { navigate };
