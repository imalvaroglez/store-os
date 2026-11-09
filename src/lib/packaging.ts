// #253 — suggest an order's packaging materials from the store's per-level
// profiles. Pure display/planning math: real charges always come from
// consuming the linked supplies (#184), never from these numbers.
import type { Order, StorePackaging } from "../types";

export type PackagingSuggestionLine = {
  materialId: string;
  name: string;
  units: number;
  estimatedCost?: number;
  supplyExpenseId?: string;
};

export type PackagingSuggestion = {
  lines: PackagingSuggestionLine[];
  estimatedCostTotal: number;
  /** Pieces per price level present in the order (informational). */
  perPieceByTier: { tier: string; pieces: number }[];
};

/**
 * The tier is resolved PER LINE (mixed-level orders exist: 9% of real orders),
 * falling back to `fallbackTier` for lines without one. perPiece materials
 * multiply by that level's pieces; perOrder materials are taken from the
 * DOMINANT level (most pieces; tie → first in line order) and applied exactly
 * ONCE per order, regardless of how many pieces or levels it has.
 */
export function suggestOrderPackaging(input: {
  order: Pick<Order, "items">;
  packaging: StorePackaging | undefined;
  fallbackTier?: string;
}): PackagingSuggestion {
  const { order, packaging, fallbackTier } = input;
  if (!packaging || packaging.materials.length === 0) {
    return { lines: [], estimatedCostTotal: 0, perPieceByTier: [] };
  }
  const piecesByTier = new Map<string, number>();
  for (const item of order.items ?? []) {
    const qty = Math.max(0, Math.round(Number(item.quantity) || 0));
    if (qty <= 0) continue;
    const tier = item.priceTier ?? fallbackTier ?? "";
    piecesByTier.set(tier, (piecesByTier.get(tier) ?? 0) + qty);
  }
  const unitsByMaterial = new Map<string, number>();
  for (const [tier, pieces] of piecesByTier) {
    for (const line of packaging.byTier[tier]?.perPiece ?? []) {
      const units = Math.max(0, Math.round(line.units)) * pieces;
      if (units > 0) {
        unitsByMaterial.set(line.materialId, (unitsByMaterial.get(line.materialId) ?? 0) + units);
      }
    }
  }
  let dominant: string | null = null;
  let max = -1;
  for (const [tier, pieces] of piecesByTier) {
    if (pieces > max) {
      max = pieces;
      dominant = tier;
    }
  }
  if (dominant != null) {
    for (const line of packaging.byTier[dominant]?.perOrder ?? []) {
      const units = Math.max(0, Math.round(line.units));
      if (units > 0) {
        unitsByMaterial.set(line.materialId, (unitsByMaterial.get(line.materialId) ?? 0) + units);
      }
    }
  }
  const lines: PackagingSuggestionLine[] = [];
  let total = 0;
  for (const material of packaging.materials) {
    const units = unitsByMaterial.get(material.id);
    if (!units) continue;
    total += units * (material.estimatedCost ?? 0);
    lines.push({
      materialId: material.id,
      name: material.name,
      units,
      ...(material.estimatedCost !== undefined ? { estimatedCost: material.estimatedCost } : {}),
      ...(material.supplyExpenseId ? { supplyExpenseId: material.supplyExpenseId } : {}),
    });
  }
  return {
    lines,
    estimatedCostTotal: total,
    perPieceByTier: [...piecesByTier.entries()].map(([tier, pieces]) => ({ tier, pieces })),
  };
}
