import type { Order, OrderIncident, Product, ProductVariant, Purchase, VariantSize } from "../types";
import { effectivePurchaseStatus } from "../types";
import { uid } from "./ids";
import { committedBreakdownForProduct } from "./inventory";
import { combinationSku, suggestSizeSkuSuffix, suggestSkuSuffix, variantSku } from "./variants";

// #461 — assisted conversion of already-separated fichas into one design sold
// by exact color×size. Pure planning/preview + pure application: the
// transaction (firestoreData) re-verifies freshness and blockers before
// applying, so a stale preview can never move pieces twice or strand a
// pending movement.

/** One origin ficha's explicit destination: a color (existing or created from
 * the origin's own data) and a talla within it. */
export type ConversionMapping = { productId: string; color: string; size: string };

/** A movement that can still move an origin's shelf — resolve it first. */
export type ConversionPending = {
  productId: string;
  kind: "order" | "purchase" | "return";
  id: string;
  label: string;
};

/** #461: what still moves each origin — pending deliveries (including
 * money-backed cancelled rows), unreceived purchases, and open incidents
 * (own piece or its replacement). Same derivations the inventory UI uses. */
export function pendingMovementsForSources(
  sources: Product[],
  orders: Order[],
  purchases: Purchase[],
  incidents: OrderIncident[]
): ConversionPending[] {
  const out: ConversionPending[] = [];
  for (const source of sources) {
    for (const row of committedBreakdownForProduct(orders, source.storeId, source.id).rows) {
      out.push({ productId: source.id, kind: "order", id: row.orderId, label: `Pedido ${row.reference} con ${row.total} pieza${row.total === 1 ? "" : "s"} por entregar${row.cancelled ? " (cancelado con pago)" : ""}` });
    }
    for (const purchase of purchases) {
      if (purchase.storeId !== source.storeId || effectivePurchaseStatus(purchase) === "received") continue;
      if (purchase.lines.some((line) => line.productId === source.id)) {
        out.push({ productId: source.id, kind: "purchase", id: purchase.id, label: `Compra sin recibir ${purchase.name ?? purchase.id}` });
      }
    }
    for (const incident of incidents) {
      const last = incident.events[incident.events.length - 1]?.kind;
      const open = last === "opened" || last === "resolution_agreed";
      if (!open) continue;
      if (incident.productId === source.id || incident.replacement?.productId === source.id) {
        out.push({ productId: source.id, kind: "return", id: incident.id, label: `Devolución pendiente de ${incident.productName}` });
      }
    }
  }
  return out;
}

export type ConversionRow = {
  productId: string;
  name: string;
  color: string;
  size: string;
  /** The origin's own clave — the combination's suggested clave, reviewable. */
  sku?: string;
  cost?: number;
  availableBefore?: number;
  committedBefore: number;
  physicalBefore?: number;
  quarantineBefore: number;
  /** Shelf landing on the combination; undefined keeps untracked stock. */
  combinationAfter?: number;
  /** Informational: the origin's public prices vs the main design's. */
  priceDifferences: Array<{ level: string; origin: number; main: number }>;
};

export type ConversionPreview = {
  rows: ConversionRow[];
  pending: ConversionPending[];
  blockers: string[];
  canConvert: boolean;
};

/** The whole plan on the table BEFORE anything moves: per origin antes/después
 * (Disponible/Comprometido/Físico), claves, costs, price differences — and
 * every reason the conversion must stop until resolved. */
export function buildConversionPreview(
  mainProduct: Product,
  sources: Product[],
  mappings: ConversionMapping[],
  context: { orders: Order[]; purchases: Purchase[]; incidents: OrderIncident[] }
): ConversionPreview {
  const blockers: string[] = [];
  if (!mainProduct.variants?.length) {
    blockers.push("La ficha principal necesita colores activos antes de unificar (actívalos en su editor).");
  }
  const byId = new Map(sources.map((s) => [s.id, s]));
  const seen = new Map<string, string>(); // normalized color|size → productId
  const rows: ConversionRow[] = [];
  for (const mapping of mappings) {
    const source = byId.get(mapping.productId);
    if (!source) continue;
    const color = mapping.color.trim();
    const size = mapping.size.trim();
    if (!color || !size) {
      blockers.push(`Asigna color y talla de ${source.name}.`);
      continue;
    }
    if (source.id === mainProduct.id) {
      blockers.push("La ficha principal no puede ser su propio origen.");
      continue;
    }
    if (source.storeId !== mainProduct.storeId) {
      blockers.push(`${source.name} pertenece a otra tienda.`);
      continue;
    }
    if (source.variants?.length) {
      blockers.push(`${source.name} se vende por color: una ficha origen debe ser simple para apuntar a una sola combinación.`);
      continue;
    }
    if (source.mergedInto || source.status === "archived") {
      blockers.push(`${source.name} ya fue fusionada en otra ficha.`);
      continue;
    }
    const key = `${color.toLocaleLowerCase("es-MX")}|${size.toLocaleLowerCase("es-MX")}`;
    const duplicate = seen.get(key);
    if (duplicate) {
      blockers.push(`Dos orígenes apuntan a la misma combinación (${color} · ${size}): la correspondencia debe ser inequívoca.`);
      continue;
    }
    seen.set(key, source.id);
    if ((source.quantityQuarantined ?? 0) > 0) {
      blockers.push(`${source.name} tiene ${source.quantityQuarantined} pieza(s) en cuarentena: resuélvela antes de unificar.`);
    }
    const committed = committedBreakdownForProduct(context.orders, source.storeId, source.id).total;
    const physical = source.quantityOnHand;
    rows.push({
      productId: source.id,
      name: source.name,
      color,
      size,
      sku: source.sku,
      cost: source.cost,
      availableBefore: typeof physical === "number" ? physical - committed : undefined,
      committedBefore: committed,
      physicalBefore: physical,
      quarantineBefore: source.quantityQuarantined ?? 0,
      combinationAfter: physical,
      priceDifferences: priceDifferences(source, mainProduct),
    });
  }
  const pending = pendingMovementsForSources(
    sources.filter((s) => mappings.some((m) => m.productId === s.id)),
    context.orders,
    context.purchases,
    context.incidents
  );
  for (const movement of pending) {
    blockers.push(`${movement.label} — resuélvelo antes de unificar.`);
  }
  return { rows, pending, blockers, canConvert: blockers.length === 0 && rows.length > 0 };
}

function priceDifferences(source: Product, mainProduct: Product): Array<{ level: string; origin: number; main: number }> {
  const out: Array<{ level: string; origin: number; main: number }> = [];
  const levels = new Set([...Object.keys(source.prices ?? {}), ...Object.keys(mainProduct.prices ?? {})]);
  for (const level of levels) {
    const a = source.prices?.[level];
    const b = mainProduct.prices?.[level];
    if (typeof a === "number" && typeof b === "number" && a !== b) out.push({ level, origin: a, main: b });
  }
  return out;
}

export type ConversionResult = { main: Product; sources: Product[] };

/** Pure application: each origin's shelf lands on its exact combination; the
 * origin retires from sale keeping identity and history, with an internal
 * note of the fusion. A NEW color is created from the origin's own gallery,
 * cost and prices — no recapture. Callers must have verified blockers +
 * freshness (the transaction does both). */
export function applyConversion(
  mainProduct: Product,
  sources: Product[],
  mappings: ConversionMapping[],
  now = new Date().toISOString()
): ConversionResult {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const variants: ProductVariant[] = [...(mainProduct.variants ?? [])];
  const archived: Product[] = [];
  for (const mapping of mappings) {
    const source = byId.get(mapping.productId);
    if (!source) continue;
    const color = mapping.color.trim();
    const sizeLabel = mapping.size.trim();
    let variant = variants.find((v) => v.color.trim().toLocaleLowerCase("es-MX") === color.toLocaleLowerCase("es-MX"));
    if (!variant) {
      variant = {
        id: uid("v"),
        color,
        skuSuffix: suggestSkuSuffix(color),
        ...(variantSku(mainProduct.sku, { skuSuffix: suggestSkuSuffix(color) }) ? { sku: variantSku(mainProduct.sku, { skuSuffix: suggestSkuSuffix(color) }) } : {}),
        photos: [...(source.images ?? [])],
        cost: source.cost,
        ...(source.prices ? { prices: { ...source.prices } } : {}),
        createdAt: now,
        updatedAt: now,
      };
      variants.push(variant);
    }
    let size: VariantSize | undefined = variant.sizes?.find((s) => s.size.trim().toLocaleLowerCase("es-MX") === sizeLabel.toLocaleLowerCase("es-MX"));
    if (!size) {
      size = {
        id: uid("z"),
        size: sizeLabel,
        sku: source.sku ?? combinationSku(mainProduct.sku, variant, { size: sizeLabel, skuSuffix: suggestSizeSkuSuffix(sizeLabel) }),
        cost: source.cost,
        ...(typeof source.quantityOnHand === "number" ? { quantityOnHand: 0 } : {}),
        createdAt: now,
        updatedAt: now,
      };
      variant.sizes = [...(variant.sizes ?? []), size];
    }
    // The shelf moves ONLY to its combination; the color's own quantityOnHand
    // stays derived (never written here) and untracked stock stays untracked.
    if (typeof source.quantityOnHand === "number") {
      size.quantityOnHand = (typeof size.quantityOnHand === "number" ? size.quantityOnHand : 0) + source.quantityOnHand;
      size.updatedAt = now;
    }
    variant.updatedAt = now;
    archived.push({
      ...source,
      status: "archived",
      isPublic: false,
      mergedInto: { productId: mainProduct.id, variantId: variant.id, sizeId: size.id, at: now },
      // The tracked shelf moved to the unified ficha — none stays here (an
      // untracked origin keeps its untracked state, never zero).
      ...(typeof source.quantityOnHand === "number" ? { quantityOnHand: 0 } : {}),
      updatedAt: now,
    });
  }
  return {
    main: { ...mainProduct, variants, updatedAt: now },
    sources: archived,
  };
}
