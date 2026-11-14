import type { LooseExpense, Order, OrderPayment } from "../types";
import { orderAmountCents } from "./orderMoney";
import { effectiveOrderStatus, orderItems } from "./orders";
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

export type MonthlyClose = {
  month: CloseMonth;
  monthLabel: string;
  salesCents: number;
  costCents: number;
  grossMarginCents: number;
  expensesCents: number;
  operatingResultCents: number;
  collectionsCents: number;
  coverage: MonthlyCloseCoverage;
};

export type CloseInputs = {
  storeId: string;
  month: CloseMonth;
  orders: Order[];
  /** Payment records per order id (subcollections, loaded on demand). */
  paymentsByOrder: Record<string, OrderPayment[] | undefined>;
  expenses: LooseExpense[];
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
        if (typeof item.cost === "number" && Number.isFinite(item.cost)) {
          costCents += orderAmountCents(item.cost, line.quantity);
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
    for (const payment of paymentsByOrder[order.id] ?? []) {
      if (payment.kind !== "payment") continue;
      if (!payment.date) {
        coverage.unconfirmedCollections.push({ orderId: order.id, reference: orderReference(order), paymentId: payment.id, amountCents: signedCents(payment.amount) });
        continue;
      }
      if (monthKeyOf({ year: Number(payment.date.slice(0, 4)), month: Number(payment.date.slice(5, 7)) }) === monthKey) {
        collectionsCents += signedCents(payment.amount);
      }
    }

    // An ANTICIPO captured on the order with NO receipt record (never
    // materialized — the operator did not register its date/method) has no
    // verifiable date either: it stays «Fecha por confirmar», out of every
    // monthly total, instead of being invented into some month.
    const materializedDeposit = (paymentsByOrder[order.id] ?? []).some((payment) => payment.id === "inherited_deposit");
    if (order.deposit > 0 && !materializedDeposit) {
      coverage.unconfirmedCollections.push({
        orderId: order.id,
        reference: orderReference(order),
        paymentId: "anticipo_sin_recibo",
        amountCents: orderAmountCents(order.deposit),
      });
    }
  }

  // ── Gastos: UNA sola vez por su fecha (las asignaciones reparten, no suman).
  let expensesCents = 0;
  for (const expense of expenses) {
    if (expense.storeId !== storeId) continue;
    if (monthKeyOf({ year: Number(expense.date.slice(0, 4)), month: Number(expense.date.slice(5, 7)) }) === monthKey) {
      expensesCents += orderAmountCents(expense.amount);
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
    costCents,
    grossMarginCents: salesCents - costCents,
    expensesCents,
    operatingResultCents: salesCents - costCents - expensesCents,
    collectionsCents,
    coverage,
  };
}

function signedCents(pesos: number): number {
  return orderAmountCents(pesos);
}
