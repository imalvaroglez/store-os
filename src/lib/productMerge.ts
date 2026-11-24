import type { Product, ProductVariant, VariantSize } from "../types";

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
/** #461: the save cannot land without losing pieces — a talla or a color
 * changed existence elsewhere while the operator was distributing it. The
 * message names what to do; nothing is written. */
export class StaleProductError extends Error {}

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
      // This editor never saw tallas that another session activated on one of
      // its colors: disabling colors would drop them (and their reservations).
      for (const baseVariant of baseline.variants ?? []) {
        const freshVariant = fresh.variants?.find((v) => v.id === baseVariant.id);
        if (freshVariant?.sizes?.length && !baseVariant.sizes?.length) {
          throw new StaleProductError(
            `El color ${freshVariant.color} ahora se vende por talla (cambió en otro dispositivo mientras editabas). Vuelve a abrir la ficha.`
          );
        }
      }
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
    // #373 r2: the COLOR's cost follows the product-level rule — untouched
    // carries the concurrent reception's average, an explicit manual edit
    // lands as captured. Only quantityOnHand used to be merged; the stale
    // clone's cost silently reverted a concurrent re-average.
    const sameCost = JSON.stringify(variant.cost ?? null) === JSON.stringify(base.cost ?? null);
    const cost = sameCost ? current.cost : variant.cost;
    return mergeColorShelf(base, variant, current, cost);
  });
}

/** One color's shelf across a save, tallas included (#461):
 * - a plain color: untouched carries the fresh shelf, an edit lands as delta;
 * - a talla follows the same rule on ITS shelf and cost;
 * - ACTIVATING tallas distributes the color's counted shelf: the fresh color
 *   must still hold what the operator split, or the save stops;
 * - pieces «sin talla» the operator distributed leave the color's own field
 *   (what arrived concurrently stays, visible);
 * - removing the last talla returns the tallas' fresh pieces to the color. */
function mergeColorShelf(base: ProductVariant, next: ProductVariant, current: ProductVariant, cost: number | undefined): ProductVariant {
  const baseSizes = base.sizes ?? [];
  const nextSizes = next.sizes ?? [];
  const currentSizes = current.sizes ?? [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const residual = (variant: ProductVariant) => (typeof variant.quantityOnHand === "number" ? variant.quantityOnHand : 0);
  const sum = (sizes: VariantSize[]) => sizes.reduce((total, size) => total + (typeof size.quantityOnHand === "number" ? size.quantityOnHand : 0), 0);

  if (!nextSizes.length) {
    if (!currentSizes.length) {
      if (baseSizes.length > 0) {
        // Another session already removed these tallas: this editor's view of
        // the color is stale — saving would put back pieces it no longer holds.
        throw new StaleProductError(
          `El color ${next.color} ya no se vende por talla (cambió en otro dispositivo mientras editabas). Vuelve a abrir la ficha.`
        );
      }
      // Plain color both sides.
      if (same(next.quantityOnHand, base.quantityOnHand)) return { ...next, quantityOnHand: current.quantityOnHand, cost };
      const delta = (next.quantityOnHand ?? 0) - (base.quantityOnHand ?? 0);
      return { ...next, quantityOnHand: Math.max(0, (current.quantityOnHand ?? 0) + delta), cost };
    }
    if (baseSizes.length === 0) {
      // This editor NEVER saw the tallas — another session activated them after
      // it opened. Saving would erase them (and strand their reservations).
      throw new StaleProductError(
        `El color ${next.color} ahora se vende por talla (cambió en otro dispositivo mientras editabas). Vuelve a abrir la ficha para ver sus tallas.`
      );
    }
    // The color stops selling by talla: its tallas' fresh pieces come back to
    // the color, together with any pieces still «sin talla» on it.
    const tracked = currentSizes.filter((size) => typeof size.quantityOnHand === "number");
    const unassigned = residual(current);
    const tallas = tracked.length > 0 ? sum(currentSizes) : undefined;
    // When the last talla left, the form showed what it had started with
    // (base tallas + base residual). A different number is a correction the
    // operator typed on purpose: it lands as a difference on the FRESH figures.
    const shownByForm = sum(baseSizes) + residual(base);
    const typedValue = typeof next.quantityOnHand === "number" ? next.quantityOnHand : undefined;
    const correction = (typedValue ?? shownByForm) - shownByForm;
    const quantityOnHand = tallas === undefined
      ? typedValue !== undefined && correction !== 0 ? typedValue : unassigned > 0 ? unassigned : current.quantityOnHand
      : tallas + unassigned + correction;
    return { ...next, quantityOnHand, cost };
  }

  if (!currentSizes.length) {
    // ACTIVATION on a counted color: the split was validated against the
    // clone — the fresh color must be that same shelf.
    if (typeof current.quantityOnHand === "number" && !same(current.quantityOnHand, base.quantityOnHand)) {
      throw new StaleProductError(
        `La existencia del color ${next.color} cambió en otro dispositivo mientras editabas. Vuelve a abrir la ficha y reparte sus piezas entre las tallas de nuevo.`
      );
    }
  }
  // A talla the operator removed must still be empty on the fresh doc.
  for (const size of currentSizes) {
    if (nextSizes.some((candidate) => candidate.id === size.id)) continue;
    if (typeof size.quantityOnHand === "number" && size.quantityOnHand !== 0) {
      throw new StaleProductError(
        `La talla ${size.size} del color ${next.color} recibió piezas en otro dispositivo mientras editabas. Vuelve a abrir la ficha y revisa sus tallas.`
      );
    }
  }
  let moved = 0;
  const sizes: VariantSize[] = nextSizes.map((size) => {
    const baseSize = baseSizes.find((candidate) => candidate.id === size.id);
    const currentSize = currentSizes.find((candidate) => candidate.id === size.id);
    if (baseSize && !currentSize) {
      throw new StaleProductError(`La talla ${size.size} del color ${next.color} ya no existe en otro dispositivo. Vuelve a abrir la ficha y revisa sus tallas.`);
    }
    // New talla — captured as is; its pieces count as moved, because
    // distributing «sin talla» pieces may land on a talla created in this edit.
    if (!baseSize || !currentSize) {
      moved += typeof size.quantityOnHand === "number" ? size.quantityOnHand : 0;
      return size;
    }
    const sizeCost = same(size.cost, baseSize.cost) ? currentSize.cost : size.cost;
    if (same(size.quantityOnHand, baseSize.quantityOnHand)) {
      return { ...size, quantityOnHand: currentSize.quantityOnHand, cost: sizeCost }; // carry the fresh shelf
    }
    const delta = (size.quantityOnHand ?? 0) - (baseSize.quantityOnHand ?? 0);
    moved += delta;
    return { ...size, quantityOnHand: Math.max(0, (currentSize.quantityOnHand ?? 0) + delta), cost: sizeCost };
  });
  let quantityOnHand = current.quantityOnHand;
  if (!currentSizes.length) {
    quantityOnHand = undefined; // every counted piece now lives in a talla
  } else if (residual(base) !== 0 && moved === residual(base)) {
    // The operator distributed the «sin talla» pieces she saw. Distributing
    // them requires that exact shelf: if another session touched this color
    // meanwhile (distributed too, sold, returned pieces), this view is stale.
    if (residual(current) !== residual(base) || !same(current.sizes ?? [], base.sizes ?? [])) {
      throw new StaleProductError(
        `Las piezas sin talla del color ${next.color} cambiaron en otro dispositivo mientras las repartías. Vuelve a abrir la ficha y repártelas de nuevo.`
      );
    }
    quantityOnHand = undefined;
  }
  return { ...next, sizes, quantityOnHand, cost };
}
