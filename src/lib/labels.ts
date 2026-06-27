import type { ProductCategory, StoreType, PriceTier } from "../types";

// Spanish labels for enums. Enum keys stay English.
export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  perfume: "Perfume",
  sneakers: "Tenis",
  cap: "Gorra",
  jewelry: "Joyería",
  other: "Otro",
};

export const CATEGORY_OPTIONS: ProductCategory[] = [
  "perfume",
  "sneakers",
  "cap",
  "jewelry",
  "other",
];

export const STORE_TYPE_LABELS: Record<StoreType, string> = {
  on_demand: "Bajo pedido",
  inventory_tiered: "Inventario y precios",
};

export const TIER_LABELS: Record<PriceTier, string> = {
  retail: "Menudeo",
  wholesale: "Mayoreo",
  reseller: "Emprendedora",
};
