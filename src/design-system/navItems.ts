import { navigate } from "../lib/router";
import type { StoreType } from "../types";

// Nav tabs. "productos" is a parent whose default route IS the product list
// (no /productos/productos). Sub-routes keep their paths — bookmarks, shared
// links and deep-links never break.
export type Tab =
  | "inicio"
  | "productos"
  | "productos_categorias"
  | "productos_compras"
  | "productos_gastos"
  | "productos_empaques"
  | "productos_reglas"
  | "productos_estrategia"
  | "productos_cierre"
  | "productos_reparto"
  | "productos_simulador"
  | "productos_diagnostico"
  | "productos_ranking"
  | "pedidos"
  | "clientes"
  | "usuarios"
  | "tienda";

export type PlatformRole = "super_admin" | "member";

export type NavLeaf = { id: Tab; label: string; path: string };

/** A navigation AREA: a pure container — it expands, never navigates. */
export type NavArea = { id: string; label: string; children: NavLeaf[] };

// #454 — single source of truth for admin navigation (contract PO 15-nov-2026).
// Exactly four areas, in this order, with these children and this copy.
// Group labels are NOT screens ("un contenedor no abre pantalla cajón de sastre").
// "Simulador de reparto" joins Administración when #459 delivers its screen —
// no dead links, no decorative "Próximamente".
const NAV_AREAS: NavArea[] = [
  {
    id: "ventas",
    label: "Ventas",
    children: [
      { id: "pedidos", label: "Pedidos", path: "/pedidos" },
      { id: "clientes", label: "Clientes", path: "/clientes" },
      { id: "productos_ranking", label: "Top emprendedoras", path: "/productos/ranking" },
    ],
  },
  {
    id: "catalogo",
    label: "Inventario y catálogo",
    children: [
      { id: "productos", label: "Productos", path: "/productos" },
      { id: "productos_categorias", label: "Categorías", path: "/productos/categorias" },
      { id: "productos_reglas", label: "Reglas de venta", path: "/productos/reglas" },
      { id: "productos_estrategia", label: "Estrategia de precios", path: "/productos/estrategia" },
    ],
  },
  {
    id: "abastecimiento",
    label: "Compras y abastecimiento",
    children: [
      { id: "productos_compras", label: "Compras", path: "/productos/compras" },
      { id: "productos_empaques", label: "Empaques", path: "/productos/empaques" },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    children: [
      { id: "productos_gastos", label: "Gastos", path: "/productos/gastos" },
      { id: "productos_cierre", label: "Cierre mensual", path: "/productos/cierre" },
      { id: "productos_reparto", label: "Reparto de utilidades", path: "/productos/reparto" },
    ],
  },
];

const FLAT_BASE: NavLeaf[] = [{ id: "inicio", label: "Inicio", path: "/" }];

export type VisibleNav = { flat: NavLeaf[]; areas: NavArea[] };

/** The navigation for one store/role: flat leaves (Inicio, Usuarios for
 * super_admin) plus the four areas, capability-filtered. Empty areas are
 * dropped — no hollow containers. */
export function visibleNav(storeType: StoreType, userRole?: PlatformRole): VisibleNav {
  const tieredOnly = (leaf: NavLeaf) =>
    storeType === "inventory_tiered" ||
    (leaf.id !== "productos_compras" && leaf.id !== "productos_reglas" && leaf.id !== "productos_estrategia");
  const areas = NAV_AREAS.map((area) => ({ ...area, children: area.children.filter(tieredOnly) })).filter(
    (area) => area.children.length > 0
  );
  const flat = [...FLAT_BASE, ...(userRole === "super_admin" ? ([{ id: "usuarios", label: "Usuarios", path: "/usuarios" }] as NavLeaf[]) : [])];
  return { flat, areas };
}

/** Which AREA holds this tab (null for flat/chrome tabs). Deep-links open it. */
export function areaIdForTab(tab: Tab): string | null {
  for (const area of NAV_AREAS) {
    if (area.children.some((leaf) => leaf.id === tab)) return area.id;
  }
  return null;
}

export { navigate };
