import type { Product, ProductVariant } from "../types";

// #373 (corte Productos): the product editor builds its save from the clone
// it OPENED with; a full-document write would silently revert concurrent
// canonical movements (receptions, orders, incidents) on the operational
// fields. This pure merge derives the saved value of each operational field:
// - UNTOUCHED by the operator → carry the FRESH doc's value (the concurrent
//   change survives).
// - EDITED by the operator → land the INTENT on top of fresh: quantities as
//   a delta (manual +2 over a concurrent +3 → fresh+2), cost as the explicit
//   value (the operator owns cost edits), variant identities as captured
//   (color management is the form's) with per-color shelves delta-merged.
// - ABSENT from the form (on_demand editor) → untouched (carries fresh).
// - PRESENT-as-undefined (the #355 color transition tombstones) → the delete
//   intent is preserved for the caller to map to deleteField().
export function mergeProductOperational(
  baseline: Product | undefined,
  next: Product,
  fresh: Product | undefined
): Product {
  if (!baseline || !fresh) return next; // create (or nothing to protect)
  const merged: Product = { ...next };

  const has = (key: string) => Object.prototype.hasOwnProperty.call(next, key);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  for (const key of ["quantityOnHand", "quantityQuarantined"] as const) {
    merged[key] = mergeCount(key as "quantityOnHand", has, same, baseline, next, fresh);
  }
  if (has("cost") && !same(next.cost, baseline.cost)) {
    merged.cost = next.cost; // explicit manual cost edit — the operator owns it
  } else {
    merged.cost = fresh.cost;
  }
  if (has("variants")) {
    if (next.variants === undefined) {
      merged.variants = undefined; // #355 disable-colors tombstone
    } else if (same(next.variants, baseline.variants)) {
      merged.variants = fresh.variants; // untouched color capture → fresh shelves
    } else {
      merged.variants = mergeVariants(baseline.variants ?? [], next.variants!, fresh.variants ?? []);
    }
  } else {
    merged.variants = fresh.variants;
  }
  return merged;
}

function mergeCount(
  key: "quantityOnHand" | "quantityQuarantined",
  has: (key: string) => boolean,
  same: (a: unknown, b: unknown) => boolean,
  baseline: Product,
  next: Product,
  fresh: Product
): number | undefined {
  const own = (p: Product) => (Object.prototype.hasOwnProperty.call(p, key) ? p[key] as number | undefined : undefined);
  if (has(key) && next[key] === undefined) return undefined; // explicit tombstone (#355)
  if (has(key) && !same(next[key], baseline[key])) {
    // Intentional edit → delta on fresh. A concurrent take can absorb the
    // manual raise; the shelf never goes below zero because counts are
    // physical pieces.
    const delta = (next[key] ?? 0) - (own(baseline) ?? 0);
    return Math.max(0, (own(fresh) ?? 0) + delta);
  }
  return own(fresh); // untouched (or absent) → carry the fresh doc
}

function mergeVariants(
  baseline: ProductVariant[],
  next: ProductVariant[],
  fresh: ProductVariant[]
): ProductVariant[] {
  const freshById = new Map(fresh.map((v) => [v.id, v]));
  const baseById = new Map(baseline.map((v) => [v.id, v]));
  return next.map((variant) => {
    const base = baseById.get(variant.id);
    const current = freshById.get(variant.id);
    if (!base || !current) return variant; // new color (or no history) — captured as-is
    const sameStock = JSON.stringify(variant.quantityOnHand ?? null) === JSON.stringify(base.quantityOnHand ?? null);
    if (sameStock) return { ...variant, quantityOnHand: current.quantityOnHand }; // carry the fresh shelf
    const delta = (variant.quantityOnHand ?? 0) - (base.quantityOnHand ?? 0);
    return { ...variant, quantityOnHand: Math.max(0, (current.quantityOnHand ?? 0) + delta) };
  });
}
