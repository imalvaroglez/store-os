import type { StoreType } from "../types";

export type AvailabilitySignal = "agotado" | "pocas" | "disponible";
type PublicAvailability = { availability?: string | null; stockSignal?: string | null };

/** #489: inventory is authoritative, including already-published legacy docs.
 * A missing signal keeps the conservative legacy fallback; never invent stock. */
export function publicAvailabilitySignal(product: PublicAvailability, storeType?: StoreType): AvailabilitySignal {
  const signal = product.stockSignal;
  if (storeType === "inventory_tiered" && (signal === "agotado" || signal === "pocas" || signal === "disponible")) return signal;
  if (product.availability === "sold_out" || signal === "agotado") return "agotado";
  if (signal === "pocas" || product.availability === "low_stock") return "pocas";
  return "disponible";
}

/** Normalize new public projections without rewriting administrative legacy data. */
export function publicAvailabilityValue(product: PublicAvailability, storeType?: StoreType): string {
  if (storeType !== "inventory_tiered" || !product.stockSignal) return product.availability ?? "available";
  const signal = publicAvailabilitySignal(product, storeType);
  return signal === "agotado" ? "sold_out" : signal === "pocas" ? "low_stock" : "available";
}
