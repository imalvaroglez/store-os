import type { LooseExpense, Order, OrderPayment } from "../types";
import { orderAmountCents } from "./orderMoney";
import { effectiveOrderStatus, orderItems } from "./orders";
import { LOOSE_EXPENSE_CATEGORY_LABEL } from "../types";
import { incidentSaleAdjustmentCents } from "./orderMoney";
import { stockDimensionKey } from "./inventory";

// #129 — etapa lista: vista previa de cierre mensual (SOLO LECTURA).
// Una sola fuente de cálculo, por mes calendario de CDMX, en centavos:
// - Ventas y costo histórico se reconocen por ENTREGAS verificables (#333:
//   cada evento con su fecha efectiva y sus piezas por línea). Ni la fecha de
//   captura, ni la promesa, ni el cobro, ni la última edición producen venta.
// - Cobros en su FECHA REAL (el registro por id y fecha; uno heredado sin
//   fecha queda «Fecha por confirmar», fuera del total mensual).
// - Gastos reconocidos UNA sola vez por su fecha; las asignaciones a pedidos
//   o compras son reparto del mismo importe, nunca un segundo gasto.
// El resultado por periodo es la entrada de la propuesta de reparto (#128).

export type CloseMonth = { year: number; month: number };

export type MonthlyCloseCoverage = {
  /** Entregados legados sin evidencia de fecha: NO entran a las ventas. */
  deliveredWithoutDate: Array<{ orderId: string; reference: string }>;
  /** Líneas vendidas sin costo conocido: la venta cuenta, el costo no se inventa. */
  linesWithoutCost: Array<{ orderId: string; reference: string; productName: string; quantity: number }>;
  /** Cobros sin fecha verificable («Fecha por confirmar»), fuera del total. */
  unconfirmedCollections: Array<{ orderId: string; reference: string; paymentId: string; amountCents: number }>;
  /** #129 r2: delivered pieces whose line left the order (evidence kept) and
   *  data too corrupt to interpret — BOTH visible, never silent. */
  deliveredWithoutLine: Array<{ orderId: string; reference: string; quantity: number }>;
  unreadableData: Array<{ orderId: string; reference: string; reason: string }>;
  /** false = hay vacíos a la vista; NO habilita un cierre oficial. */
  complete: boolean;
};

/** #456: one traceable money row — the drilldown's unit. Signed semantics:
 * sales/collections positive, costs/expenses negative, so `sum(details) ==
 * ±figure` reconciles to the exact cent. */
export type CloseContribution = {
  /** Effective date (YYYY-MM-DD): entrega para venta/costo, fecha real para
   * cobro, fecha del gasto — never updatedAt nor capture. */
  date: string;
  kind: "sale" | "cost" | "expense" | "collection";
  reference: string;
  orderId?: string;
  /** #456 r2: the human behind the row (orders carry a clienta; gastos no). */
  customerName?: string;
  /** Product/concept legible (venta/costo/gasto) o método del cobro. */
  concept: string;
  productName?: string;
  amountCents: number;
  evidence: "verified" | "pending";
};

export type CollectionGroupKey = "anticipos_del_mes" | "liquidaciones_del_mes" | "pagos_de_ventas_previas" | "sin_clasificar" | "reembolsos_posventa";

export const COLLECTION_GROUP_LABELS: Record<CollectionGroupKey, string> = {
  anticipos_del_mes: "Anticipos del mes",
  liquidaciones_del_mes: "Liquidaciones del mes",
  pagos_de_ventas_previas: "Pagos de ventas previas",
  sin_clasificar: "Origen pendiente de clasificar",
  reembolsos_posventa: "Reembolsos de posventa (salida)",
};

export type CollectionGroup = { group: CollectionGroupKey; label: string; totalCents: number; count: number };

export type CloseDetails = {
  sales: CloseContribution[];
  costs: CloseContribution[];
  expenses: CloseContribution[];
  collections: CloseContribution[];
  /** Money that STAYS OUT of every monthly total, with its explicit cause. */
  excludedCollections: Array<{ reference: string; orderId: string; amountCents: number; cause: string }>;
};

export type MonthlyClose = {
  month: CloseMonth;
  monthLabel: string;
  salesCents: number;
  /** #455 r3 (UX): the NET effect of confirmed posventa adjustments this
   * month (refunds/replacements deltas) — the number the dashboard surfaces
   * so net sales never look unexplained against the operadora's notebook. */
  posventaAdjustmentCents: number;
  costCents: number;
  grossMarginCents: number;
  expensesCents: number;
  operatingResultCents: number;
  collectionsCents: number;
  coverage: MonthlyCloseCoverage;
  /** #456: traceable rows per figure (same loops as the totals — no second
   * source of truth; sums reconcile exactly). */
  details: CloseDetails;
  /** Collections grouped by origin — groups reconcile to collectionsCents. */
  collectionGroups: CollectionGroup[];
  /** True when pieces were sold with UNKNOWN cost: the operating result is a
   * partial estimate, never presented as final. */
  costCoverage: { partialByMissingCost: boolean };
};

export type CloseInputs = {
  storeId: string;
  month: CloseMonth;
  orders: Order[];
  /** Payment records per order id (subcollections, loaded on demand). */
  paymentsByOrder: Record<string, OrderPayment[] | undefined>;
  expenses: LooseExpense[];
  /** #456 r2: clienta names for the traceable rows (optional — Sin clienta). */
  customers?: Array<{ id: string; name: string }>;
};

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Calendar month (YYYY-MM) in America/Mexico_City. A date-only string
 * (YYYY-MM-DD — the effective LOCAL dates deliveries and cobros carry, per
 * #333/#123) IS its own CDMX date: reading it as UTC midnight would shift day
 * 1 to the previous month. Only full instants resolve through the zone.
 */
export function cdmxMonthKey(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(0, 7);
  // en-CA yields YYYY-MM-DD; slicing keeps it stable across engines.
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).format(new Date(iso));
  return date.slice(0, 7);
}

/** Today's DATE (YYYY-MM-DD) in America/Mexico_City — never the UTC slice
 * (the UTC day rolls 6h before CDMX midnight; #458 r2 review MAYOR-1). */
export function cdmxToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Key of the queried month (YYYY-MM). */
export function monthKeyOf(month: CloseMonth): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

function orderReference(order: Order): string {
  return `#${order.id.replace(/^order_?/, "").slice(0, 6).toUpperCase() || order.id.slice(0, 6)}`;
}

/** Read-only monthly close preview. Pure — never writes, never closes. */
export function monthlyClose(inputs: CloseInputs): MonthlyClose {
  const { storeId, month, orders, paymentsByOrder, expenses } = inputs;
  const customerNameOf = (customerId: string | undefined) =>
    inputs.customers?.find((c) => c.id === customerId)?.name ?? "Sin clienta";
  const monthKey = monthKeyOf(month);
  const coverage: MonthlyCloseCoverage = {
    deliveredWithoutDate: [],
    linesWithoutCost: [],
    unconfirmedCollections: [],
    deliveredWithoutLine: [],
    unreadableData: [],
    complete: true,
  };

  let salesCents = 0;
  let costCents = 0;
  let collectionsCents = 0;
  let posventaAdjustmentCents = 0;
  const details: CloseDetails = { sales: [], costs: [], expenses: [], collections: [], excludedCollections: [] };
  const groupTotals = new Map<CollectionGroupKey, { totalCents: number; count: number }>();

  for (const order of orders) {
    if (order.storeId !== storeId) continue;
    const items = orderItems(order);

    // ── Ventas: entregas verificables, cada evento UNA vez (id idempotente).
    // #129 r2: corrupt amounts/dates degrade THIS order into coverage instead
    // of throwing RangeError and killing the whole preview.
    let unreadable = false;
    const seenDeliveryIds = new Set<string>();
    for (const delivery of order.deliveries ?? []) {
      if (seenDeliveryIds.has(delivery.id)) continue; // retry of the same intent
      seenDeliveryIds.add(delivery.id);
      if (typeof delivery.deliveredAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(delivery.deliveredAt)) {
        unreadable = true;
        continue;
      }
      if (cdmxMonthKey(delivery.deliveredAt) !== monthKey) continue;
      for (const line of delivery.lines) {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
        const item = items.find((candidate) => stockDimensionKey(candidate.productId ?? "", candidate.variantId) === stockDimensionKey(line.productId, line.variantId));
        if (!item) {
          // The delivery declares pieces whose line left the order: the
          // evidence stays VISIBLE (review r2: never silently dropped).
          coverage.deliveredWithoutLine.push({ orderId: order.id, reference: orderReference(order), quantity: line.quantity });
          continue;
        }
        if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice)) {
          unreadable = true;
          continue;
        }
        salesCents += orderAmountCents(item.unitPrice, line.quantity);
        details.sales.push({
          date: delivery.deliveredAt.slice(0, 10),
          kind: "sale",
          reference: orderReference(order),
          orderId: order.id,
          customerName: customerNameOf(order.customerId),
          concept: `Venta entregada · ${item.productName}`,
          productName: item.productName,
          amountCents: orderAmountCents(item.unitPrice, line.quantity),
          evidence: "verified",
        });
        if (typeof item.cost === "number" && Number.isFinite(item.cost)) {
          const costAmount = orderAmountCents(item.cost, line.quantity);
          costCents += costAmount;
          details.costs.push({
            date: delivery.deliveredAt.slice(0, 10),
            kind: "cost",
            reference: orderReference(order),
            orderId: order.id,
            customerName: customerNameOf(order.customerId),
            concept: `Costo de ${item.productName}`,
            productName: item.productName,
            amountCents: -costAmount,
            evidence: "verified",
          });
        } else {
          coverage.linesWithoutCost.push({ orderId: order.id, reference: orderReference(order), productName: item.productName, quantity: line.quantity });
        }
      }
    }
    if (unreadable) {
      coverage.unreadableData.push({ orderId: order.id, reference: orderReference(order), reason: "monto o fecha no interpretable" });
    }

    // Legacy «Entregado» without delivery evidence: no verifiable date —
    // stays OUT of the sales and VISIBLE (never silently recognized).
    if ((order.deliveries ?? []).length === 0 && effectiveOrderStatus(order) === "delivered") {
      coverage.deliveredWithoutDate.push({ orderId: order.id, reference: orderReference(order) });
    }

    // ── Cobros: su fecha real. Sin fecha = «Fecha por confirmar» (fuera del total).
    // Delivery evidence (valid dates only) classifies the origin of each in-month
    // payment: money before ANY delivery = anticipo; after a delivery in an
    // EARLIER month = pago de venta previa; after a same-month delivery =
    // liquidación. No evidence = origen pendiente de clasificar (never guessed).
    const deliveryDates = (order.deliveries ?? [])
      .filter((d) => typeof d.deliveredAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.deliveredAt))
      .map((d) => d.deliveredAt.slice(0, 10))
      .sort();
    for (const payment of paymentsByOrder[order.id] ?? []) {
      // #458 r3 (UX review): a dated ADJUSTMENT participates SIGNED in its
      // date month — the operadora's own corrective path discounts. Skipping
      // them left duplicated collections standing after a repair.
      if (payment.kind !== "payment" && payment.kind !== "adjustment") continue;
      if (payment.kind === "adjustment" && payment.date) {
        if (monthKeyOf({ year: Number(payment.date.slice(0, 4)), month: Number(payment.date.slice(5, 7)) }) === monthKey) {
          const amount = signedCents(payment.amount);
          collectionsCents += amount;
          details.collections.push({
            date: payment.date,
            kind: "collection",
            reference: orderReference(order),
            orderId: order.id,
            customerName: customerNameOf(order.customerId),
            concept: "Ajuste correctivo de cobros",
            amountCents: amount,
            evidence: "verified",
          });
          const adjBucket = groupTotals.get("sin_clasificar") ?? { totalCents: 0, count: 0 };
          adjBucket.totalCents += amount;
          adjBucket.count += 1;
          groupTotals.set("sin_clasificar", adjBucket);
        }
        continue;
      }
      if (!payment.date) {
        coverage.unconfirmedCollections.push({ orderId: order.id, reference: orderReference(order), paymentId: payment.id, amountCents: signedCents(payment.amount) });
        details.excludedCollections.push({ reference: orderReference(order), orderId: order.id, amountCents: signedCents(payment.amount), cause: "sin fecha verificable" });
        continue;
      }
      if (monthKeyOf({ year: Number(payment.date.slice(0, 4)), month: Number(payment.date.slice(5, 7)) }) === monthKey) {
        const amount = signedCents(payment.amount);
        collectionsCents += amount;
        let group: CollectionGroupKey;
        if (deliveryDates.length === 0) {
          group = "sin_clasificar";
        } else if (payment.date < deliveryDates[0]) {
          group = "anticipos_del_mes";
        } else if (deliveryDates.every((d) => cdmxMonthKey(d) < monthKey)) {
          group = "pagos_de_ventas_previas";
        } else {
          group = "liquidaciones_del_mes";
        }
        const bucket = groupTotals.get(group) ?? { totalCents: 0, count: 0 };
        bucket.totalCents += amount;
        bucket.count += 1;
        groupTotals.set(group, bucket);
        details.collections.push({
          date: payment.date,
          kind: "collection",
          reference: orderReference(order),
          orderId: order.id,
          customerName: customerNameOf(order.customerId),
          concept: COLLECTION_GROUP_LABELS[group],
          amountCents: amount,
          evidence: "verified",
        });
      }
    }

    // ── #456 r2: posventa CONFIRMADA ajusta el mes de su confirmación
    // (#203/#212): a refund reverses the sale AND the reversible cost (the
    // piece returns to the shelf); a charged replacement books its delta.
    // An agreed-but-unconfirmed refund stays OUT (compromised ≠ confirmed).
    for (const incident of order.incidents ?? []) {
      const confirmedAt = (incident.events ?? []).find((event) => event.kind === "confirmed")?.at;
      if (!confirmedAt || cdmxMonthKey(confirmedAt) !== monthKey) continue;
      const adjustment = incidentSaleAdjustmentCents(incident);
      if (!adjustment) continue;
      salesCents += adjustment;
      posventaAdjustmentCents += adjustment;
      details.sales.push({
        date: confirmedAt.slice(0, 10),
        kind: "sale",
        reference: orderReference(order),
        orderId: order.id,
        customerName: customerNameOf(order.customerId),
        concept: "Ajuste de posventa confirmado (devolución o reemplazo)",
        amountCents: adjustment,
        evidence: "verified",
      });
      // #455 r4 (UX): the EXECUTED refund is money that LEFT in its own
      // month — "Dinero recibido" must net it as a signed outflow or the
      // figure never reconciles with the cashbox. The confirmation month
      // owns it (execution follows confirmation in the same flow).
      const executedRefundCents = (incident.events ?? []).reduce(
        (sum, event) => sum + ((event.kind === "confirmed" || event.kind === "refund_executed") && typeof event.detail?.refundExecutedCents === "number" && Number.isSafeInteger(event.detail.refundExecutedCents) ? event.detail.refundExecutedCents : 0),
        0
      );
      if (executedRefundCents > 0) {
        collectionsCents -= executedRefundCents;
        const refundBucket = groupTotals.get("reembolsos_posventa") ?? { totalCents: 0, count: 0 };
        refundBucket.totalCents -= executedRefundCents;
        refundBucket.count += 1;
        groupTotals.set("reembolsos_posventa", refundBucket);
        details.collections.push({
          date: confirmedAt.slice(0, 10),
          kind: "collection",
          reference: orderReference(order),
          orderId: order.id,
          customerName: customerNameOf(order.customerId),
          concept: "Reembolso de posventa entregado",
          amountCents: -executedRefundCents,
          evidence: "verified",
        });
      }
      // Reversible cost: the refunded piece's line, when its cost is KNOWN.
      if (adjustment < 0 && typeof incident.quantity === "number") {
        const item = items.find(
          (candidate) => stockDimensionKey(candidate.productId ?? "", candidate.variantId) === stockDimensionKey(incident.productId ?? "", incident.variantId)
        );
        if (item && typeof item.cost === "number" && Number.isFinite(item.cost)) {
          const costReversal = orderAmountCents(item.cost, incident.quantity);
          costCents -= costReversal;
          details.costs.push({
            date: confirmedAt.slice(0, 10),
            kind: "cost",
            reference: orderReference(order),
            orderId: order.id,
            concept: `Costo reversible de ${item.productName} (pieza devuelta)`,
            productName: item.productName,
            amountCents: costReversal,
            evidence: "verified",
          });
        }
      }
    }

    // An ANTICIPO captured on the order with NO receipt record (never
    // materialized — the operator did not register its date/method) has no
    // verifiable date either: it stays «Fecha por confirmar», out of every
    // monthly total, instead of being invented into some month.
    const materializedDeposit =
      (paymentsByOrder[order.id] ?? []).some((payment) => payment.id === "inherited_deposit") ||
      order.inheritedDepositMaterialized === true;
    if (order.deposit > 0 && !materializedDeposit) {
      coverage.unconfirmedCollections.push({
        orderId: order.id,
        reference: orderReference(order),
        paymentId: "anticipo_sin_recibo",
        amountCents: orderAmountCents(order.deposit),
      });
      details.excludedCollections.push({ reference: orderReference(order), orderId: order.id, amountCents: orderAmountCents(order.deposit), cause: "anticipo sin recibo (sin fecha verificable)" });
    }
  }

  // ── Gastos: UNA sola vez por su fecha (las asignaciones reparten, no suman).
  let expensesCents = 0;
  for (const expense of expenses) {
    if (expense.storeId !== storeId) continue;
    if (monthKeyOf({ year: Number(expense.date.slice(0, 4)), month: Number(expense.date.slice(5, 7)) }) === monthKey) {
      const amount = orderAmountCents(expense.amount);
      expensesCents += amount;
      details.expenses.push({
        date: expense.date.slice(0, 10),
        kind: "expense",
        reference: `#${expense.id.slice(0, 6).toUpperCase()}`,
        concept: LOOSE_EXPENSE_CATEGORY_LABEL[expense.category] ?? "Gasto",
        amountCents: -amount,
        evidence: "verified",
      });
    }
  }

  coverage.complete =
    coverage.deliveredWithoutDate.length === 0 &&
    coverage.linesWithoutCost.length === 0 &&
    coverage.unconfirmedCollections.length === 0 &&
    coverage.deliveredWithoutLine.length === 0 &&
    coverage.unreadableData.length === 0;

  return {
    month,
    monthLabel: `${MONTH_NAMES[month.month - 1]} ${month.year}`,
    salesCents,
    posventaAdjustmentCents,
    costCents,
    grossMarginCents: salesCents - costCents,
    expensesCents,
    operatingResultCents: salesCents - costCents - expensesCents,
    collectionsCents,
    coverage,
    details,
    collectionGroups: [...groupTotals.entries()].map(([group, bucket]) => ({
      group,
      label: COLLECTION_GROUP_LABELS[group],
      totalCents: bucket.totalCents,
      count: bucket.count,
    })),
    costCoverage: { partialByMissingCost: coverage.linesWithoutCost.length > 0 },
  };
}

function signedCents(pesos: number): number {
  // Adjustments carry NEGATIVE pesos; orderAmountCents rejects them. Exact
  // cents with the sign preserved — a −$15.00 adjustment is −1500 cents.
  if (!Number.isFinite(pesos)) throw new Error("Invalid order amount");
  return Math.round(pesos * 100);
}
