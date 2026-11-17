// #279 frente 1: posición financiera desde la activación (T0). Derivación
// pura, centavos exactos, supuestos visibles — nada de esto es un saldo
// bancario confirmado: es la posición REGISTRADA de la tienda desde que el
// módulo se activó. Contrato: lo previo a T0 no se reconstruye ni se inventa;
// el método de pago se captura una sola vez en cada documento; el pago de
// tarjeta reduce caja y adeudo y NUNCA duplica un gasto (el costo de la
// compra vive en el inventario, no aquí).
import type { CardPayment, LooseExpense, OrderPayment, Purchase, PurchasePaymentMethod } from "../../types";

export const PURCHASE_PAYMENT_METHOD_LABEL: Record<PurchasePaymentMethod, string> = {
  credit_card: "Tarjeta de crédito",
  account: "Cuenta (débito)",
  cash: "Efectivo",
  third_party_advance: "Adelanto de tercero",
};

export type FinancialPositionInput = {
  /** T0 — ISO instant the store activated the module. */
  activatedAt: string;
  /** Money IN: order payments (already carry their real date). */
  payments: Array<{ date?: string; amountCents?: number; amount?: number }>;
  /** Money OUT with a one-time payment method (total in decimal pesos). */
  purchases: Array<{ date: string; total: number; paymentMethod?: PurchasePaymentMethod }>;
  expenses: Array<{ date: string; amount: number; paymentMethod?: PurchasePaymentMethod }>;
  /** Card payments: reduce cash AND card debt — never a second expense. */
  cardPayments: Array<{ date: string; amountCents: number }>;
};

export type FinancialPosition = {
  /** Cobros − salidas pagadas con dinero propio − pagos de tarjeta. */
  registeredCashCents: number;
  /** Compras + gastos a tarjeta − pagos de tarjeta (clamped at 0). */
  cardDebtCents: number;
  /** Compras/gastos pagados por un tercero a nombre de la tienda. */
  thirdPartyDebtCents: number;
  /** Salidas sin método capturado: ni caja ni adeudo — visible, never guessed. */
  unclassifiedOutflowsCents: number;
  notes: string[];
};

/** Decimal pesos → exact cents (never NaN). */
export function centsOf(pesos: number | undefined): number {
  if (pesos === undefined || !Number.isFinite(pesos)) return 0;
  return Math.round(pesos * 100);
}

function onOrAfter(date: string | undefined, activatedAt: string): boolean {
  // Dates may be YYYY-MM-DD or full ISO; lexicographic comparison is exact
  // for same-format prefixes, and YYYY-MM-DD of T0's day must COUNT (the
  // activation day itself belongs to the new ledger).
  if (!date) return false;
  return date.slice(0, 10) >= activatedAt.slice(0, 10);
}

export function financialPosition(input: FinancialPositionInput): FinancialPosition {
  const notes: string[] = ["Cifras registradas desde la activación — sin saldo bancario confirmado."];

  const collected = input.payments
    .filter((payment) => onOrAfter(payment.date, input.activatedAt))
    .reduce((sum, payment) => sum + (payment.amountCents ?? centsOf(payment.amount)), 0);

  let paidWithOwnMoney = 0;
  let cardCharged = 0;
  let thirdParty = 0;
  let unclassified = 0;
  for (const outflow of [
    ...input.purchases.map((purchase) => ({ date: purchase.date, cents: centsOf(purchase.total), method: purchase.paymentMethod })),
    ...input.expenses.map((expense) => ({ date: expense.date, cents: centsOf(expense.amount), method: expense.paymentMethod })),
  ]) {
    if (!onOrAfter(outflow.date, input.activatedAt)) continue;
    switch (outflow.method) {
      case "credit_card": cardCharged += outflow.cents; break;
      case "cash":
      case "account": paidWithOwnMoney += outflow.cents; break;
      case "third_party_advance": thirdParty += outflow.cents; break;
      default: unclassified += outflow.cents; break;
    }
  }

  const cardPaid = input.cardPayments
    .filter((payment) => onOrAfter(payment.date, input.activatedAt))
    .reduce((sum, payment) => sum + payment.amountCents, 0);

  const rawCardDebt = cardCharged - cardPaid;
  if (rawCardDebt < 0) {
    notes.push(`Se pagó más tarjeta (${(cardPaid / 100).toLocaleString("es-MX", { style: "currency", "currency": "MXN" })}) de lo adeudado desde la activación — revisa los pagos registrados.`);
  }
  if (unclassified > 0) {
    notes.push(`Hay salidas sin método de pago (${(unclassified / 100).toLocaleString("es-MX", { style: "currency", "currency": "MXN" })}) que no entran ni en caja ni en adeudos: clasifícalas editando su compra o gasto.`);
  }

  return {
    registeredCashCents: collected - paidWithOwnMoney - cardPaid,
    cardDebtCents: Math.max(0, rawCardDebt),
    thirdPartyDebtCents: thirdParty,
    unclassifiedOutflowsCents: unclassified,
    notes,
  };
}

/** The store's position from activation, straight from app state.
 * #279 QA (MAYOR-1): the shared payments cache accumulates every store
 * opened in the session — only THIS store's collections enter the position. */
export function positionOfStore(input: {
  activatedAt: string;
  storeId: string;
  payments: OrderPayment[];
  purchases: Purchase[];
  expenses: LooseExpense[];
  cardPayments: CardPayment[];
}): FinancialPosition {
  return financialPosition({
    activatedAt: input.activatedAt,
    payments: input.payments
      .filter((payment) => payment.storeId === input.storeId)
      .map((payment) => ({ date: payment.date, amountCents: payment.amountCents ?? centsOf(payment.amount) })),
    purchases: input.purchases.map((purchase) => ({ date: purchase.date, total: purchase.totalConfirmed, paymentMethod: purchase.paymentMethod })),
    expenses: input.expenses.map((expense) => ({ date: expense.date, amount: expense.amount, paymentMethod: expense.paymentMethod })),
    cardPayments: input.cardPayments.map((payment) => ({ date: payment.date, amountCents: payment.amountCents })),
  });
}

/** #279: the contextual default for the next capture — the method of the
 * most recent recorded purchase/expense that carries one. Undefined when
 * nothing has been classified yet (the form then leaves the choice open). */
export function lastPaymentMethodUsed(input: {
  purchases: Purchase[];
  expenses: LooseExpense[];
}): PurchasePaymentMethod | undefined {
  const tagged: Array<{ date: string; method: PurchasePaymentMethod }> = [
    ...input.purchases.flatMap((purchase) => (purchase.paymentMethod ? [{ date: purchase.date, method: purchase.paymentMethod }] : [])),
    ...input.expenses.flatMap((expense) => (expense.paymentMethod ? [{ date: expense.date, method: expense.paymentMethod }] : [])),
  ];
  tagged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return tagged[0]?.method;
}
