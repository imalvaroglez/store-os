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
import type { Order, OrderIncident, OrderItem } from "../../types";
import { orderItems } from "../../lib/orders";
import { orderAmountCents } from "../../lib/orderMoney";

function eventsOf(incident: OrderIncident): OrderIncident["events"] {
  return Array.isArray(incident.events) ? incident.events : [];
}

function centsOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export type IncidentPieceLocation =
  | "with_customer"
  | "quarantined"
  // repaired ≠ released: stays non-sellable until Fer authorizes
  // the return to sale or writes it off (#203 r2).
  | "repaired_held"
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
    if (kinds.has("provider_replacement") || kinds.has("returned_to_sale")) {
      pieceLocation = "back_in_stock";
    } else if (kinds.has("written_off")) {
      pieceLocation = "written_off";
    } else if (kinds.has("repaired")) {
      pieceLocation = "repaired_held"; // repaired ≠ released: still quarantined
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
    quarantinedQuantity: pieceLocation === "quarantined" || pieceLocation === "repaired_held" ? Math.max(1, Math.round(incident.quantity || 1)) : 0,
    replacementOutQuantity: confirmed && incident.resolution?.kind !== "refund" && !incident.resolution?.waitUntil ? Math.max(1, Math.round(incident.quantity || 1)) : 0,
    refundExecutedCents,
  };
}

// The money derivations live with the order-doc money truth (lib/orderMoney);
/**
 * #368: the line an incident sits on is EVIDENCE of the agreed solution —
 * quantity, unit price and piece identity sustain the incident's sale
 * adjustment (and through it, the clienta's real credit position). A line
 * edit that removes or reshapes that line re-derives a smaller effective
 * total and INVENTS saldo a favor out of an already-refunded piece. This
 * guard derives the constraint from the SAVED doc (the truth), so only the
 * incident flow itself may move that evidence. Returns the operator-facing
 * error, or null when the edit keeps every incident's line intact.
 */
/** #368: the save was rejected because a line that sustains an incident
 * would be rewritten — the editor shows THIS message (the capture stays). */
export class IncidentEvidenceError extends Error {}

export function incidentEvidenceError(
  previous: Pick<Order, "items" | "incidents"> | undefined,
  nextItems: OrderItem[]
): string | null {
  const incidents = previous?.incidents;
  if (!incidents?.length) return null;
  for (const incident of incidents) {
    const prevItems = orderItems(previous!);
    const prevLine = incident.lineId
      ? prevItems.find((item) => item.lineId === incident.lineId)
      : prevItems.find((item) => item.productId === incident.productId && item.variantId === incident.variantId);
    if (!prevLine) continue; // legacy drift: no resolvable evidence line to protect
    const nextLine = incident.lineId
      ? nextItems.find((item) => item.lineId === incident.lineId)
      : nextItems.find((item) => item.productId === incident.productId && item.variantId === incident.variantId);
    const where = `${incident.productName}${incident.variantColor ? ` · ${incident.variantColor}` : ""}`;
    if (!nextLine) {
      return `«${where}» tiene una incidencia registrada: esa línea es la evidencia de la solución y no se puede quitar del pedido. Los cambios de esa atención se registran desde la incidencia.`;
    }
    if (nextLine.productId !== prevLine.productId || nextLine.variantId !== prevLine.variantId) {
      return `«${where}» tiene una incidencia registrada: la pieza de esa línea sostiene la solución y no se puede cambiar por otra.`;
    }
    if ((nextLine.quantity ?? 0) !== (prevLine.quantity ?? 0)) {
      return `«${where}» tiene una incidencia registrada: la cantidad (${prevLine.quantity ?? 0}) sostiene la solución registrada y no se puede cambiar en el editor.`;
    }
    if (orderAmountCents(nextLine.unitPrice) !== orderAmountCents(prevLine.unitPrice)) {
      return `«${where}» tiene una incidencia registrada: el precio de esa línea sostiene la solución registrada y no se puede cambiar en el editor.`;
    }
  }
  return null;
}

// re-exported here so the incident domain stays one import away.
export { incidentsSaleAdjustmentCents, incidentsRefundPendingCents } from "../../lib/orderMoney";
