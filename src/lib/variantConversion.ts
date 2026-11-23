import type { Order, OrderIncident, Product, ProductVariant, Purchase, VariantSize } from "../types";
import { effectivePurchaseStatus } from "../types";
import { uid } from "./ids";
import { committedBreakdownForProduct } from "./inventory";
import { formatMoneyPlain } from "./money";
import {
  combinationSku,
  mergeCombinationCost,
  storeClaves,
  suggestSizeSkuSuffix,
  suggestSkuSuffix,
  totalStock,
  unassignedPieces,
  variantHasSizes,
  variantSku,
} from "./variants";
import { variantEffectivePrice } from "./variantPrice";

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
  /** The origin's shelf — already net of what its orders hold. */
  availableBefore?: number;
  committedBefore: number;
  /** Everything the origin holds: shelf plus the pieces its orders still hold. */
  physicalBefore?: number;
  quarantineBefore: number;
  /** Shelf landing on the combination; undefined keeps untracked stock. */
  combinationAfter?: number;
  /** Review 23-nov: when the talla already exists, its whole shelf after the
   * merge (existing + origin) — what the combination will hold. */
  combinationTotalAfter?: number;
  /** Review 23-nov: the combination's cost once both shelves merge — weighted
   * when both are known; a missing cost never erases the known one. */
  combinationCostAfter?: number;
  /** The origin's photo — it becomes the color's gallery when the color is new. */
  photoUrl: string | null;
  /** The existing color's photo (null when the color is new). */
  colorPhotoUrl: string | null;
  colorIsNew: boolean;
  /** The origin's public prices against the color it joins (the design's
   * prices when the color is new). A side without a price for a level is
   * `undefined` — «sin precio», never the other side's figure. */
  priceDifferences: PriceDifference[];
};

type PriceDifference = { level: string; origin?: number; main?: number };

export type ConversionPreview = {
  rows: ConversionRow[];
  pending: ConversionPending[];
  blockers: string[];
  canConvert: boolean;
  /** #461: the unified design's whole shelf before and after — the preview
   * never hides a lost piece. Null = nothing tracked. */
  mainPhysical: { before: number | null; after: number | null };
  /** Pieces the unified design already holds «sin talla»; the conversion
   * leaves them untouched, but the totals count them (review 23-nov). */
  unassignedInMain: number;
};

/** The whole plan on the table BEFORE anything moves: per origin antes/después
 * (Disponible/Comprometido/Físico), claves, costs, price differences — and
 * every reason the conversion must stop until resolved. */
export function buildConversionPreview(
  mainProduct: Product,
  sources: Product[],
  mappings: ConversionMapping[],
  context: {
    orders: Order[];
    purchases: Purchase[];
    incidents: OrderIncident[];
    levelLabels?: Record<string, string>;
    /** The store's fichas, to check a new color's clave against the catalog. */
    products?: Product[];
  }
): ConversionPreview {
  const blockers: string[] = [];
  const levelName = (level: string) => context.levelLabels?.[level] ?? level;
  const money = (amount: number | undefined) => (amount === undefined ? "sin precio" : formatMoneyPlain(amount));
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
    // #461: the color of the unified design this origin joins, if it exists.
    const existing = mainProduct.variants?.find(
      (v) => v.color.trim().toLocaleLowerCase("es-MX") === color.toLocaleLowerCase("es-MX")
    );
    const differences = priceDifferences(source, mainProduct, existing);
    // Review 23-nov: an origin and a design must price the same WAY. A
    // single-price origin would sell at the design's levels (or its level
    // prices would be dropped in a single-price design) — a tariff change by
    // inference. Stop and say which side to adjust.
    if (!!source.prices !== !!mainProduct.prices) {
      const originLevels = !!source.prices;
      blockers.push(
        originLevels
          ? `${source.name} tiene precios por nivel y el diseño unificado tiene un precio único: al unificar se perderían sus precios. Ajusta una de las dos fichas antes de unificar.`
          : `${source.name} no tiene precios por nivel y el diseño unificado vende por niveles: al unificar se vendería a los precios del diseño. Ajusta una de las dos fichas antes de unificar.`
      );
    }
    // Dictamen QA 23-nov (mayor): joining an EXISTING color keeps that color's
    // tariffs — a difference is Fer's call, never overwritten by inference. A
    // new color keeps the origin's own prices (#467), so the same difference
    // is fine there. In a single-price store no color can keep its own price.
    const singlePrice = !source.prices && !mainProduct.prices;
    if ((existing || singlePrice) && differences.length > 0) {
      const detail = differences
        .map((d) => `${levelName(d.level)}: origen ${money(d.origin)} · ${existing ? `color ${existing.color}` : "diseño"} ${money(d.main)}`)
        .join("; ");
      blockers.push(
        singlePrice
          ? `${source.name} tiene un precio distinto al del diseño (${detail}). En esta tienda el precio se comparte entre colores: ajusta una de las dos fichas antes de unificar.`
          : `${source.name} tiene precios distintos a los del diseño (${detail}). Fer decide cuál conservar: ajusta una de las dos fichas antes de unificar.`
      );
    }
    // Dictamen QA 23-nov (menor): the clave the new combination would take
    // (the origin's own, or the suggested one) must be free in that color.
    if (existing) {
      const candidate = (
        source.sku ?? combinationSku(mainProduct.sku, existing, { size, skuSuffix: suggestSizeSkuSuffix(size) }) ?? ""
      ).toUpperCase();
      const sizeLabel = size;
      const taken = new Set(
        [existing.sku ?? "", ...(existing.sizes ?? []).map((talla) => talla.sku ?? "")]
          .filter((clave) => clave.toUpperCase() === candidate)
      );
      const sameLabel = (existing.sizes ?? []).some(
        (talla) => talla.size.trim().toLocaleLowerCase("es-MX") === sizeLabel.toLocaleLowerCase("es-MX")
      );
      if (candidate && taken.size > 0 && !sameLabel) {
        blockers.push(`La clave ${candidate} ya la usa el color ${existing.color} del diseño unificado. Cambia la clave de ${source.name} antes de unificar.`);
      }
    }
    // Review 23-nov: a NEW color takes the clave its name suggests — it must be
    // free in the design and in the catalog (colors and tallas of every ficha).
    if (!existing && mainProduct.variants) {
      const candidate = (variantSku(mainProduct.sku, { skuSuffix: suggestSkuSuffix(color) }) ?? "").toUpperCase();
      const designClaves = new Set(
        mainProduct.variants.flatMap((v) => [(v.sku ?? "").toUpperCase(), ...(v.sizes ?? []).map((talla) => (talla.sku ?? "").toUpperCase())])
      );
      if (candidate && designClaves.has(candidate)) {
        blockers.push(`La clave ${candidate} que tomaría el color nuevo ${color} ya la usa otro color o talla del diseño unificado. Usa otro nombre de color.`);
      } else if (candidate && context.products && storeClaves(context.products, mainProduct.storeId, mainProduct.id).has(candidate)) {
        blockers.push(`La clave ${candidate} que tomaría el color nuevo ${color} ya la usa otra ficha del catálogo. Usa otro nombre de color.`);
      }
    }
    // Dictamen QA 23-nov (crítico 3): pieces the existing color counts WITHOUT
    // a talla have no unambiguous combination — stop and say what to do.
    if (existing && !variantHasSizes(existing) && typeof existing.quantityOnHand === "number" && existing.quantityOnHand !== 0) {
      const pieces = existing.quantityOnHand;
      blockers.push(
        `El color ${existing.color} de la ficha principal tiene ${pieces} ${pieces === 1 ? "pieza contada" : "piezas contadas"} sin talla. Para unificar con tallas, abre la ficha principal, agrega sus tallas y reparte esas piezas; después vuelve a unificar.`
      );
    }
    if ((source.quantityQuarantined ?? 0) > 0) {
      blockers.push(`${source.name} tiene ${source.quantityQuarantined} pieza(s) en cuarentena: resuélvela antes de unificar.`);
    }
    const committed = committedBreakdownForProduct(context.orders, source.storeId, source.id).total;
    // The origin's shelf is already NET of its reservations: it is what is
    // available; Físico adds the pieces its orders still hold (review 23-nov).
    const net = source.quantityOnHand;
    const existingTalla = existing?.sizes?.find(
      (talla) => talla.size.trim().toLocaleLowerCase("es-MX") === size.toLocaleLowerCase("es-MX")
    );
    rows.push({
      productId: source.id,
      name: source.name,
      color,
      size,
      sku: source.sku,
      cost: source.cost,
      availableBefore: net,
      committedBefore: committed,
      physicalBefore: typeof net === "number" ? net + committed : undefined,
      quarantineBefore: source.quantityQuarantined ?? 0,
      combinationAfter: net,
      ...(existingTalla && typeof existingTalla.quantityOnHand === "number" && typeof net === "number"
        ? { combinationTotalAfter: existingTalla.quantityOnHand + net }
        : {}),
      combinationCostAfter: existingTalla
        ? mergeCombinationCost(existingTalla.cost, existingTalla.quantityOnHand, source.cost, net)
        : source.cost,
      photoUrl: source.images?.find((image) => image.isPrimary)?.url ?? source.images?.[0]?.url ?? source.imageUrl ?? null,
      colorPhotoUrl: existing
        ? existing.photos?.find((photo) => photo.isPrimary)?.url ?? existing.photos?.[0]?.url ?? null
        : null,
      colorIsNew: !existing,
      priceDifferences: differences,
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
  // Every origin shelf lands on its combination (blockers stop any other
  // outcome), so the unified design holds exactly what both sides held.
  const whole = (values: Array<number | null | undefined>) => {
    const tracked = values.filter((value): value is number => typeof value === "number");
    return tracked.length === 0 ? null : tracked.reduce((sum, value) => sum + value, 0);
  };
  const mainStock = totalStock(mainProduct);
  const unassignedInMain = (mainProduct.variants ?? []).reduce((sum, variant) => sum + unassignedPieces(variant), 0);
  const loose = unassignedInMain > 0 ? unassignedInMain : undefined;
  return {
    rows,
    pending,
    blockers,
    canConvert: blockers.length === 0 && rows.length > 0,
    mainPhysical: {
      before: whole([mainStock, loose, ...rows.map((row) => row.availableBefore)]),
      after: whole([mainStock, loose, ...rows.map((row) => row.combinationAfter)]),
    },
    unassignedInMain,
  };
}

/** The origin's prices against the color it joins — that color's EFFECTIVE
 * prices when it exists (#467: its own map or the design's shared one). A
 * level priced on only one side is a difference too: merging would change
 * what is sellable. */
function priceDifferences(source: Product, mainProduct: Product, existing?: ProductVariant): PriceDifference[] {
  const out: PriceDifference[] = [];
  const tiered = !!source.prices || !!mainProduct.prices || !!existing?.prices;
  if (!tiered) {
    if (source.price !== mainProduct.price) out.push({ level: "precio", origin: source.price, main: mainProduct.price });
    return out;
  }
  const reference = existing ? (existing.prices ?? mainProduct.prices ?? {}) : (mainProduct.prices ?? {});
  const levels = new Set([...Object.keys(source.prices ?? {}), ...Object.keys(reference)]);
  for (const level of levels) {
    const originPrice = source.prices?.[level];
    const mainPrice = existing ? variantEffectivePrice(existing, level, mainProduct) : mainProduct.prices?.[level];
    if (originPrice === mainPrice) continue;
    out.push({ level, origin: originPrice, main: mainPrice });
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
  // Work on copies: the caller's product never changes (it may feed a preview
  // or a retry).
  const variants: ProductVariant[] = (mainProduct.variants ?? []).map((variant) => ({
    ...variant,
    ...(variant.sizes ? { sizes: variant.sizes.map((size) => ({ ...size })) } : {}),
  }));
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
    const existingSize = variant.sizes?.find(
      (s) => s.size.trim().toLocaleLowerCase("es-MX") === sizeLabel.toLocaleLowerCase("es-MX")
    );
    let size: VariantSize;
    if (existingSize) {
      size = existingSize;
      // The talla now holds both shelves: the cost merges the way a reception
      // would — weighted when both are known, BEFORE the origin's pieces land
      // (review 23-nov: the origin's cost used to be dropped in silence).
      size.cost = mergeCombinationCost(size.cost, size.quantityOnHand, source.cost, source.quantityOnHand);
    } else {
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
