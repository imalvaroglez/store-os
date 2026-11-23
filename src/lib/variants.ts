import type { OrderItem, Product, ProductVariant, VariantSize } from "../types";

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
    // #461: totals are derived from the color level, which itself derives
    // from its combinations when sizes exist. No tracked color = untracked
    // design (null), NOT zero — "sin dato" must never read as "agotado" (#124 M5).
    const stocks: Array<number | null> = product.variants!.map((v) => variantStock(v));
    if (!stocks.some((s) => s !== null)) return null;
    return stocks.reduce((sum: number, s) => sum + (s ?? 0), 0);
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
    // #461: a line with a size moves its COMBINATION, never the color shelf.
    if (!item.productId || !item.variantId || item.variantSizeId) return;
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

export type CombinationStockDelta = { productId: string; variantId: string; sizeId: string; delta: number };

/**
 * #461: per-combination reservation deltas — the size-level companion of
 * `variantReservationDeltas`. A line carrying variantSizeId moves EXACTLY
 * its combination (color × size); lines without it are not combination
 * business (the color/product functions own them).
 */
export function combinationReservationDeltas(oldItems: OrderItem[], newItems: OrderItem[]): Map<string, CombinationStockDelta> {
  const deltas = new Map<string, CombinationStockDelta>();
  const add = (item: OrderItem, sign: number) => {
    if (!item.productId || !item.variantId || !item.variantSizeId) return;
    const key = `${item.productId}:${item.variantId}:${item.variantSizeId}`;
    const current = deltas.get(key);
    const delta = sign * item.quantity;
    deltas.set(key, {
      productId: item.productId,
      variantId: item.variantId,
      sizeId: item.variantSizeId,
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

// #461 (PO 22-nov): sizes under a color. Pure helpers only — callers write
// state. Stock lives per combination; color/design totals are DERIVED.

/** Auto-suggested clave suffix for a size: the size itself, ASCII-safe,
 * uppercase, no spaces (editable by the operator at all times). */
export function suggestSizeSkuSuffix(size: string): string {
  return size.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toUpperCase() || "X";
}

/** The combination's full clave: color clave + "-" + size (either editable). */
export function combinationSku(
  designSku: string | undefined,
  variant: Pick<ProductVariant, "sku" | "skuSuffix">,
  size: Pick<VariantSize, "size" | "sku" | "skuSuffix">
): string | undefined {
  if (size.sku) return size.sku;
  const colorClave = variantSku(designSku, variant);
  const suffix = size.skuSuffix ?? suggestSizeSkuSuffix(size.size);
  if (!colorClave || !suffix) return undefined;
  return `${colorClave}-${suffix}`;
}

/** Does this color sell per exact size? (Non-empty sizes array.) */
export function variantHasSizes(variant: Pick<ProductVariant, "sizes">): boolean {
  return Array.isArray(variant.sizes) && variant.sizes.length > 0;
}

/** Tracked stock of a color: per-combination sum when sizes exist, the
 * color's own quantityOnHand otherwise. Untracked (all undefined) = null,
 * never zero — same rule as the design level (#124 M5). */
export function variantStock(variant: Pick<ProductVariant, "quantityOnHand" | "sizes">): number | null {
  if (variantHasSizes(variant)) {
    const tracked = variant.sizes!.some((s) => typeof s.quantityOnHand === "number");
    if (!tracked) return null;
    return variant.sizes!.reduce((sum, s) => sum + (typeof s.quantityOnHand === "number" ? s.quantityOnHand : 0), 0);
  }
  return typeof variant.quantityOnHand === "number" && Number.isFinite(variant.quantityOnHand) ? variant.quantityOnHand : null;
}

/** The exact sellable combination (color id + size id) — «Plateado · 6»
 * never exists: a size outside its color resolves to undefined. */
export function findCombination(
  product: Pick<Product, "variants">,
  variantId: string,
  sizeId: string
): VariantSize | undefined {
  return product.variants?.find((v) => v.id === variantId)?.sizes?.find((s) => s.id === sizeId);
}

/** Save-time validation for a new combination (PO 22-nov, opción A): the
 * clave is required (suggested, editable) and the acquisition cost must be
 * CONFIRMED — undefined blocks the save, a confirmed zero does not. */
export function combinationSaveError(
  color: string,
  variant: Pick<ProductVariant, "sku" | "skuSuffix">,
  size: Pick<VariantSize, "size" | "sku" | "skuSuffix" | "cost">,
  designSku?: string
): string | null {
  if (!combinationSku(designSku, variant, size)) {
    return `La talla ${size.size} del color ${color} necesita su clave.`;
  }
  if (typeof size.cost !== "number" || !Number.isFinite(size.cost)) {
    return `Confirma el costo de la talla ${size.size} del color ${color} para guardarla.`;
  }
  return null;
}

/** Publish validation for size combinations: distinct sizes within a color,
 * a unique clave per combination, and every combination save-valid. */
export function combinationPublishError(product: Pick<Product, "sku" | "variants">): string | null {
  for (const variant of product.variants ?? []) {
    if (!variantHasSizes(variant)) continue;
    const labels = variant.sizes!.map((s) => s.size.trim().toLowerCase());
    if (new Set(labels).size !== variant.sizes!.length) {
      return `El color ${variant.color} tiene una talla repetida.`;
    }
    const claves = new Set<string>();
    for (const size of variant.sizes!) {
      const clave = combinationSku(product.sku, variant, size);
      if (!clave) return `La talla ${size.size} del color ${variant.color} necesita su clave.`;
      if (claves.has(clave)) {
        return `Dos tallas del color ${variant.color} comparten la clave ${clave}.`;
      }
      claves.add(clave);
    }
  }
  return null;
}

/** Every clave a store already uses — designs, colors and tallas — upper-
 * cased, for uniqueness checks of a new combination (#461: claves travel in
 * purchases, tickets and returns, so a repeated one is ambiguous). */
export function storeClaves(
  products: ReadonlyArray<Pick<Product, "id" | "storeId" | "sku" | "variants">>,
  storeId: string,
  excludeProductId?: string
): Set<string> {
  const claves = new Set<string>();
  for (const product of products) {
    if (product.storeId !== storeId || product.id === excludeProductId) continue;
    if (product.sku) claves.add(product.sku.toUpperCase());
    for (const variant of product.variants ?? []) {
      if (variant.sku) claves.add(variant.sku.toUpperCase());
      for (const size of variant.sizes ?? []) if (size.sku) claves.add(size.sku.toUpperCase());
    }
  }
  return claves;
}

/** Pieces a color still holds OUTSIDE its tallas — its «sin talla» shelf:
 * counted before the color sold by size, or returned by an order sold
 * without talla. They are real pieces awaiting a talla; never zero-filled. */
export function unassignedPieces(variant: Pick<ProductVariant, "quantityOnHand" | "sizes">): number {
  if (!variantHasSizes(variant)) return 0;
  const residual = variant.quantityOnHand;
  return typeof residual === "number" && Number.isFinite(residual) ? residual : 0;
}

/**
 * #461 (dictamen QA 23-nov, crítico 3): the shelf rule of ONE color across a
 * save — checked against the form before anything is written. Every piece of
 * the color stays accounted for:
 * - activating tallas on a counted color, or distributing pieces «sin talla»,
 *   requires an EXACT split (nothing appears, nothing vanishes, no talla is
 *   deduced); a negative shelf is corrected first;
 * - a talla with pieces cannot be removed until it is at 0, and never while
 *   orders hold pieces of it;
 * - removing the last talla simply returns the pieces to the color.
 * `before` is the loaded talla (undefined for a color created in this edit —
 * then whatever was typed as the color's existence is what gets split).
 * Returns the first blocking message, or null when the save conserves stock.
 */
export function sizeShelfError(args: {
  color: string;
  before: ProductVariant | undefined;
  after: ProductVariant;
  /** Ids of this design's tallas with pieces held by orders. */
  heldSizeIds: ReadonlySet<string>;
}): string | null {
  const { color, before, after, heldSizeIds } = args;
  const beforeSizes = before?.sizes ?? [];
  const afterSizes = after.sizes ?? [];
  const beforeSized = beforeSizes.length > 0;
  const afterSized = afterSizes.length > 0;
  for (const size of beforeSizes) {
    if (afterSizes.some((candidate) => candidate.id === size.id)) continue;
    if (heldSizeIds.has(size.id)) {
      return `La talla ${size.size || "(sin nombre)"} del color ${color} tiene piezas apartadas en pedidos. Entrega o cancela esos pedidos antes de quitarla.`;
    }
    if (afterSized && typeof size.quantityOnHand === "number" && size.quantityOnHand !== 0) {
      return `La talla ${size.size} del color ${color} todavía tiene ${size.quantityOnHand} pieza${size.quantityOnHand === 1 ? "" : "s"}. Deja su existencia en 0 antes de quitarla.`;
    }
  }
  if (!afterSized) return null;
  const residual = before ? before.quantityOnHand : after.quantityOnHand;
  if (typeof residual !== "number" || !Number.isFinite(residual) || residual === 0) return null;
  if (!beforeSized && residual < 0) {
    return `El color ${color} tiene existencias en negativo (${residual === -1 ? "falta 1" : `faltan ${-residual}`}). Corrige el conteo del color antes de activar tallas.`;
  }
  // What the tallas gain or lose in this edit, against the pieces awaiting one.
  const sum = (sizes: VariantSize[]) => sizes.reduce((total, size) => total + (typeof size.quantityOnHand === "number" ? size.quantityOnHand : 0), 0);
  const captured = afterSizes.filter((size) => typeof size.quantityOnHand === "number");
  const moved = sum(afterSizes) - sum(beforeSizes);
  if (captured.length === afterSizes.length && moved === residual) return null;
  const origin = beforeSized
    ? residual === 1
      ? `El color ${color} tiene 1 pieza sin talla (por ejemplo, devuelta por un pedido vendido sin talla). Repártela capturando su cantidad en una talla`
      : `El color ${color} tiene ${residual} piezas sin talla (por ejemplo, devueltas por un pedido vendido sin talla). Repártelas capturando su cantidad en cada talla`
    : residual === 1
      ? `El color ${color} tenía 1 pieza contada sin talla. Repártela entre sus tallas`
      : `El color ${color} tenía ${residual} piezas contadas sin talla. Repártelas entre sus tallas`;
  return `${origin} para guardar (llevas ${moved} de ${residual}).${captured.length < afterSizes.length ? " Revisa las tallas sin cantidad." : ""}`;
}

/** Apply a stock delta to ONE combination (pure): returns the updated
 * variants array, or null when the combination no longer exists — the
 * caller decides; stock never lands on the color or design level. The
 * color's own quantityOnHand is never written (it is derived). */
export function applyCombinationDelta(
  product: Pick<Product, "variants">,
  variantId: string,
  sizeId: string,
  delta: number,
  now = new Date().toISOString()
): ProductVariant[] | null {
  if (!isVariantProduct(product)) return null;
  let touched = false;
  const next = product.variants!.map((variant) => {
    if (variant.id !== variantId || !variantHasSizes(variant)) return variant;
    let sizeTouched = false;
    const sizes = variant.sizes!.map((size) => {
      if (size.id !== sizeId) return size;
      sizeTouched = true;
      const base = typeof size.quantityOnHand === "number" ? size.quantityOnHand : 0;
      return { ...size, quantityOnHand: base + delta, updatedAt: now };
    });
    if (!sizeTouched) return variant;
    touched = true;
    return { ...variant, sizes, updatedAt: now };
  });
  return touched ? next : null;
}
