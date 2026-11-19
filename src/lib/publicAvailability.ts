import type { StoreType } from "../types";

export type AvailabilitySignal = "agotado" | "pocas" | "disponible";
type PublicAvailability = {
  availability?: string | null;
  stockSignal?: string | null;
  variants?: { stockSignal?: string | null }[];
};
const isSignal = (value: unknown): value is AvailabilitySignal =>
  value === "agotado" || value === "pocas" || value === "disponible";

/** #489: inventory is authoritative, including already-published legacy docs.
 * A missing signal keeps the conservative legacy fallback; never invent stock. */
export function publicAvailabilitySignal(product: PublicAvailability, storeType?: StoreType): AvailabilitySignal {
  const signal = product.stockSignal;
  if (storeType === "inventory_tiered") {
    const colors = product.variants;
    if (colors?.length && colors.every((v) => isSignal(v.stockSignal))) {
      if (colors.every((v) => v.stockSignal === "agotado")) return "agotado";
      if (signal === "pocas") return "pocas";
      return colors.some((v) => v.stockSignal === "disponible") ? "disponible" : "pocas";
    }
    if (isSignal(signal)) return signal;
  }
  if (product.availability === "sold_out" || signal === "agotado") return "agotado";
  if (signal === "pocas" || product.availability === "low_stock") return "pocas";
  return "disponible";
}

/** Normalize new public projections without rewriting administrative legacy data. */
export function publicAvailabilityValue(product: PublicAvailability, storeType?: StoreType): string {
  const hasSignal = isSignal(product.stockSignal) || (product.variants?.length && product.variants.every((v) => isSignal(v.stockSignal)));
  if (storeType !== "inventory_tiered" || !hasSignal) return product.availability ?? "available";
  const signal = publicAvailabilitySignal(product, storeType);
  return signal === "agotado" ? "sold_out" : signal === "pocas" ? "low_stock" : "available";
}
