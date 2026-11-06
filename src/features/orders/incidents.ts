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
    .filter((event) => event.kind === "confirmed" || event.kind === "refund_executed")
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

// The money derivations live with the order-doc money truth (lib/orderMoney);
// re-exported here so the incident domain stays one import away.
export { incidentsSaleAdjustmentCents, incidentsRefundPendingCents } from "../../lib/orderMoney";
