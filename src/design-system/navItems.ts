import { navigate } from "../lib/router";
import type { StoreType } from "../types";

export type Tab = "inicio" | "catalogo" | "pedidos" | "clientes" | "inventario";

// Single source of truth for admin navigation. Shared by BottomNav (mobile)
// and Sidebar (desktop) so the two never drift.
export const NAV_ITEMS: { id: Tab; label: string; path: string }[] = [
  { id: "inicio", label: "Inicio", path: "/" },
  { id: "catalogo", label: "Catálogo", path: "/catalogo-admin" },
  { id: "pedidos", label: "Pedidos", path: "/pedidos" },
  { id: "clientes", label: "Clientes", path: "/clientes" },
  { id: "inventario", label: "Inventario", path: "/inventario" },
];

// Inventario tab only exists for inventory-tiered stores.
export function visibleNavItems(storeType: StoreType) {
  return NAV_ITEMS.filter((t) => t.id !== "inventario" || storeType === "inventory_tiered");
}

export { navigate };
