// After-sales incidents (#203): the money and piece rules behind one ficha
// linked to the order that sold the piece. The PO's product decisions
// (2026-11-05 round — the issue is the contract) drive everything:
// - Equivalent replacement is the default and charges nothing.
// - A different piece adjusts the EFFECTIVE sale by the price difference
//   (charged to the clienta, or absorbed by the store as atención comercial).
// - A refund takes the piece out of the sale at its HISTORICAL price and the
//   money stays BLOCKED (refund pending) until it is actually handed back —
//   it is never available credit by default (credit needs explicit acceptance).
// - The damaged piece is quarantined (not sellable) until Fer explicitly
//   authorizes returning it to sale, repairs it, writes it off, or the
//   provider replaces it. Every step is an append-only event; all state here
//   is DERIVED, never stored twice.
// Money flows through customerCredit (#189) — there is no second balance.
import type { OrderIncident } from "../../types";

function eventsOf(incident: OrderIncident): OrderIncident["events"] {
  return Array.isArray(incident.events) ? incident.events : [];
}

function centsOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export type IncidentPieceLocation =
  | "with_customer"
  | "quarantined"
  | "back_in_stock"
  | "written_off";

export type IncidentState = {
  opened: boolean;
  resolution?: NonNullable<OrderIncident["resolution"]>;
  /** Recepción de la pieza dañada + entrega de la solución, juntas. */
  confirmed: boolean;
  pieceLocation: IncidentPieceLocation;
  /** Damaged pieces currently not sellable (quarantine effect). */
  quarantinedQuantity: number;
  /** Replacement pieces that left stock when the incident was confirmed. */
  replacementOutQuantity: number;
  /** Money actually handed back to the clienta (executed refunds), cents. */
  refundExecutedCents: number;
};

/** The whole state of a ficha, derived from its append-only events. */
export function incidentState(incident: OrderIncident): IncidentState {
  const kinds = new Set(eventsOf(incident).map((event) => event.kind));
  const confirmed = kinds.has("confirmed");
  let pieceLocation: IncidentPieceLocation = "with_customer";
  if (confirmed) {
    pieceLocation = "quarantined";
    if (kinds.has("repaired") || kinds.has("provider_replacement") || kinds.has("returned_to_sale")) {
      pieceLocation = "back_in_stock";
    } else if (kinds.has("written_off")) {
      pieceLocation = "written_off";
    }
  }
  const refundExecutedCents = eventsOf(incident)
    .filter((event) => event.kind === "confirmed")
    .reduce((sum, event) => sum + centsOf(event.detail?.refundExecutedCents), 0);
  return {
    opened: kinds.has("opened"),
    resolution: incident.resolution,
    confirmed,
    pieceLocation,
    quarantinedQuantity: pieceLocation === "quarantined" ? Math.max(1, Math.round(incident.quantity || 1)) : 0,
    replacementOutQuantity: confirmed && incident.resolution?.kind !== "refund" && !incident.resolution?.waitUntil ? Math.max(1, Math.round(incident.quantity || 1)) : 0,
    refundExecutedCents,
  };
}

/**
 * Σ sale adjustments in exact cents: how the incidents change the order's
 * EFFECTIVE total (the historical sale stays intact — this is a documented
 * adjustment, never a rewrite). Replacements adjust by the price difference
 * when charged; absorbed upgrades and equivalent replacements change nothing;
 * a refund removes the piece at its historical price.
 */
export function incidentsSaleAdjustmentCents(incidents: OrderIncident[] | undefined | null): number {
  return (incidents ?? []).reduce((sum, incident) => {
    const resolution = incident.resolution;
    if (!resolution || resolution.kind === "wait_restock") return sum;
    if (resolution.kind === "refund") {
      return sum - centsOf(resolution.refundUnitPriceCents) * Math.max(1, Math.round(incident.quantity || 1));
    }
    const replacement = incident.replacement;
    if (!replacement || !replacement.chargeDifference) return sum;
    // Difference = the alternative's agreed price vs the line's HISTORICAL
    // price frozen at open. Negative for a cheaper alternative (the clienta's
    // favor — she then chooses refund or credit; #189 handles the money).
    const quantity = Math.max(1, Math.round(incident.quantity || 1));
    const original = centsOf(incident.originalUnitPriceCents);
    return sum + (replacement.unitPriceCents - original) * quantity;
  }, 0);
}

/**
 * Σ refund money still blocked (agreed but not executed), exact cents. This
 * amount is EXCLUDED from available credit (#189): "un importe comprometido
 * a reembolso queda separado y no se usa para otra compra sin aceptación de
 * la clienta". Executing the refund (handed back) releases the block once.
 */
export function incidentsRefundPendingCents(incidents: OrderIncident[] | undefined | null): number {
  return (incidents ?? []).reduce((sum, incident) => {
    const resolution = incident.resolution;
    if (!resolution || resolution.kind !== "refund") return sum;
    const quantity = Math.max(1, Math.round(incident.quantity || 1));
    const agreed = centsOf(resolution.refundUnitPriceCents) * quantity;
    return sum + Math.max(0, agreed - incidentState(incident).refundExecutedCents);
  }, 0);
}
