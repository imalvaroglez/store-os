import type { OrderItem, Product, ProductVariant } from "../types";

// #124 — color variants of a design (PO decisions 2026-11-09): pure helpers
// for stock math, claves, publish validation and per-color reservations.
// Callers write state; this file never does.

/** Is this a design sold per exact color? (Non-empty variants array.) */
export function isVariantProduct(product: Pick<Product, "variants">): boolean {
  return Array.isArray(product.variants) && product.variants.length > 0;
}

/** Auto-suggested clave suffix for a color (PO decision 3): first letter,
 * uppercase, ASCII-safe; editable by the operator at all times. */
export function suggestSkuSuffix(color: string): string {
  const letter = color.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "X";
}

/** The variant's full clave: design sku + "-" + suffix (either editable). */
export function variantSku(designSku: string | undefined, variant: Pick<ProductVariant, "skuSuffix" | "sku">): string | undefined {
  if (variant.sku) return variant.sku;
  if (!designSku || !variant.skuSuffix) return undefined;
  return `${designSku}-${variant.skuSuffix}`;
}

/**
 * Publish validation for a variant design (PO decisions 1–3). Returns the
 * first blocking error in operator Spanish, or null when publishable:
 * every color named distinctly, its own photo (>=1) and its own clave.
 */
export function variantPublishError(product: Pick<Product, "sku" | "variants">): string | null {
  const variants = product.variants ?? [];
  const colors = variants.map((v) => v.color.trim().toLowerCase());
  if (new Set(colors).size !== variants.length) {
    return "Cada color debe tener un nombre distinto.";
  }
  for (const variant of variants) {
    if (!variant.color.trim()) return "Cada variedad necesita su color.";
    if (!variant.photos || variant.photos.length === 0) {
      return `El color ${variant.color} necesita al menos una foto para publicarse.`;
    }
    if (!variantSku(product.sku, variant)) {
      return `El color ${variant.color} necesita su clave.`;
    }
  }
  return null;
}

/** Aggregate stock of a product: per-variant sum for designs, the product's
 * own quantityOnHand otherwise (null = untracked). */
export function totalStock(product: Pick<Product, "variants" | "quantityOnHand">): number | null {
  if (isVariantProduct(product)) {
    // No color with a tracked shelf = untracked design (null), NOT zero —
    // "sin dato" must never read as "agotado" (#124 review M5).
    const tracked = product.variants!.some((v) => typeof v.quantityOnHand === "number");
    if (!tracked) return null;
    return product.variants!.reduce((sum, v) => sum + (typeof v.quantityOnHand === "number" ? v.quantityOnHand : 0), 0);
  }
  return typeof product.quantityOnHand === "number" && Number.isFinite(product.quantityOnHand) ? product.quantityOnHand : null;
}

export type VariantStockDelta = { productId: string; variantId: string; delta: number };

/**
 * Per-color reservation deltas for an order change — the #124 companion of
 * `reservationDeltas`: a line with variantId moves ITS color's stock, never
 * the design-level field. Lines without variantId are not variant business.
 */
export function variantReservationDeltas(oldItems: OrderItem[], newItems: OrderItem[]): Map<string, VariantStockDelta> {
  const deltas = new Map<string, VariantStockDelta>();
  const add = (item: OrderItem, sign: number) => {
    if (!item.productId || !item.variantId) return;
    const key = `${item.productId}:${item.variantId}`;
    const current = deltas.get(key);
    const delta = sign * item.quantity;
    deltas.set(key, {
      productId: item.productId,
      variantId: item.variantId,
      delta: (current?.delta ?? 0) + delta,
    });
  };
  for (const item of oldItems) add(item, 1);
  for (const item of newItems) add(item, -1);
  return new Map([...deltas].filter(([, d]) => d.delta !== 0));
}

/** Apply a variant delta to a product doc (pure): returns the updated
 * variants array, or null when the variant no longer exists (the caller
 * decides — stock never silently lands on the design level). */
export function applyVariantDelta(
  product: Pick<Product, "variants">,
  variantId: string,
  delta: number,
  now = new Date().toISOString()
): ProductVariant[] | null {
  if (!isVariantProduct(product)) return null;
  let touched = false;
  const next = product.variants!.map((variant) => {
    if (variant.id !== variantId) return variant;
    touched = true;
    const base = typeof variant.quantityOnHand === "number" ? variant.quantityOnHand : 0;
    return { ...variant, quantityOnHand: base + delta, updatedAt: now };
  });
  return touched ? next : null;
}

/** The variant an order line refers to, resolved against the current doc. */
export function lineVariant(product: Pick<Product, "variants">, item: Pick<OrderItem, "variantId">): ProductVariant | undefined {
  return product.variants?.find((v) => v.id === item.variantId);
}
