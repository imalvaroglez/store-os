import {
  isSaleExpense,
  recalcPurchaseStatus,
  type Product,
  type Purchase,
  type PurchaseCostAllocation,
  type PurchaseExpense,
  type PurchaseExpenseAdjustment,
  type PurchaseTicket,
} from "../types";
import { applyPurchaseLines, type ProductStockUpdate } from "./inventory";

export function legacyPurchaseTicket(purchase: Purchase): PurchaseTicket {
  return {
    id: `ticket:${purchase.id}`, supplierId: purchase.supplierId, supplierName: purchase.supplierName,
    folio: purchase.supplierOrder, totalConfirmed: purchase.totalConfirmed,
    discount: purchase.discount, shipping: purchase.shipping, tax: purchase.tax,
    documentPath: purchase.documentPath, documentFingerprint: purchase.documentFingerprint,
  };
}

function cents(amount: number): number {
  const value = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(value)) {
    throw new Error("Revisa los importes de la compra: deben ser cantidades válidas y positivas o cero.");
  }
  return value;
}

/** Exact largest-remainder allocation; stable line IDs resolve equal remainders. */
export function allocateCents(amount: number, weights: { id: string; weight: number }[]): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0 || weights.some((item) => !Number.isSafeInteger(item.weight) || item.weight < 0)) {
    throw new Error("No se pudo repartir el gasto. Revisa los importes y las cantidades.");
  }
  const total = weights.reduce((sum, item) => sum + BigInt(item.weight), 0n);
  if (total === 0n) {
    if (amount === 0) return weights.map(() => 0);
    throw new Error("Agrega piezas antes de repartir los gastos.");
  }
  const values = weights.map((item, index) => {
    const numerator = BigInt(amount) * BigInt(item.weight);
    return { index, id: item.id, value: Number(numerator / total), remainder: numerator % total };
  });
  const result = values.map((item) => item.value);
  const remaining = amount - result.reduce((sum, value) => sum + value, 0);
  values.sort((a, b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) result[values[index].index] += 1;
  return result;
}

/** Original ticket costs stay untouched; all attributed totals are integer cents. */
export function purchaseCostAllocation(purchase: Purchase): PurchaseCostAllocation[] {
  const tickets = purchase.tickets ?? [legacyPurchaseTicket(purchase)];
  const ticketIds = new Set(tickets.map((ticket) => ticket.id));
  const lineIds = new Set(purchase.lines.map((line) => line.lineId));
  if (ticketIds.size !== tickets.length || lineIds.size !== purchase.lines.length) throw new Error("Hay líneas o tickets repetidos en la compra.");
  const allocations = purchase.lines.map((line) => {
    const ticketId = line.ticketId ?? (purchase.tickets ? "" : tickets[0].id);
    if (!line.lineId || !ticketIds.has(ticketId) || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Revisa el ticket y la cantidad de cada producto.");
    }
    return { lineId: line.lineId, merchandiseCents: cents(line.quantity * line.unitCost), supplierAdjustmentCents: 0, sourcingExpenseCents: 0, totalCents: 0 };
  });
  for (const ticket of tickets) {
    const indices = purchase.lines.map((line, index) => ({ line, index }))
      .filter(({ line }) => (line.ticketId ?? tickets[0].id) === ticket.id);
    const unitWeights = indices.map(({ line }) => ({ id: line.lineId!, weight: line.quantity }));
    const valueWeights = indices.map(({ line, index }) => ({ id: line.lineId!, weight: allocations[index].merchandiseCents }));
    const merchandise = valueWeights.reduce((sum, item) => sum + item.weight, 0);
    const discount = cents(ticket.discount ?? 0);
    if (discount > merchandise) throw new Error("El descuento no puede ser mayor que los productos del ticket.");
    const discounts = allocateCents(discount, valueWeights);
    const taxes = allocateCents(cents(ticket.tax ?? 0), merchandise > 0 ? valueWeights : unitWeights);
    const shipping = allocateCents(cents(ticket.shipping ?? 0), unitWeights);
    indices.forEach(({ index }, position) => {
      allocations[index].supplierAdjustmentCents = shipping[position] + taxes[position] - discounts[position];
    });
  }
  const expenseCents = (purchase.sourcingExpenses ?? []).reduce((sum, expense) => {
    const amount = cents(expense.amount);
    return sum + ((expense.includeInInventoryCost ?? expense.category === "sourcing_transport") ? amount : 0);
  }, 0);
  // Sale-side expenses (delivery, packaging) get their own per-piece allocation
  // that NEVER enters totalCents — counting them in the inventory cost would
  // double count once they are charged at sale time (FER-02).
  const saleCents = (purchase.sourcingExpenses ?? []).reduce((sum, expense) => sum + (isSaleExpense(expense) ? cents(expense.amount) : 0), 0);
  const weights = purchase.lines.map((line) => ({ id: line.lineId!, weight: line.quantity }));
  const expenses = allocateCents(expenseCents, weights);
  const saleExpenses = allocateCents(saleCents, weights);
  return allocations.map((allocation, index) => ({
    ...allocation,
    sourcingExpenseCents: expenses[index],
    saleExpenseCents: saleExpenses[index],
    totalCents: allocation.merchandiseCents + allocation.supplierAdjustmentCents + expenses[index],
  }));
}

/**
 * Build an append-only post-reception adjustment entry (FER-02). Pure: the
 * caller owns persistence. Sale categories carry an exact per-line allocation;
 * every other category is outlay evidence only and allocates nothing.
 */
export function purchaseExpenseAdjustment(purchase: Purchase, expense: PurchaseExpense, at: string): PurchaseExpenseAdjustment {
  if (!expense.id) throw new Error("Falta identificar el gasto.");
  // A late adjustment records real money out: zero or empty is a capture error.
  if (!Number.isFinite(expense.amount) || expense.amount <= 0) {
    throw new Error("Revisa los importes del gasto: deben ser cantidades válidas y positivas.");
  }
  const amountCents = cents(expense.amount);
  const entry: PurchaseExpenseAdjustment = {
    id: expense.id,
    at,
    category: expense.category,
    amount: expense.amount,
    ...(expense.description ? { description: expense.description } : {}),
  };
  if (!isSaleExpense(expense)) return entry;
  if (purchase.lines.some((line) => !line.lineId)) throw new Error("Esta compra tiene líneas sin identidad; no se puede repartir el gasto.");
  const weights = purchase.lines.map((line) => ({ id: line.lineId!, weight: line.quantity }));
  const values = allocateCents(amountCents, weights);
  entry.allocations = purchase.lines.map((line, index) => ({ lineId: line.lineId!, saleExpenseCents: values[index] }));
  return entry;
}

/** Sale-side cents per line: the reception allocation plus every adjustment. */
export function effectiveSaleExpenseCents(purchase: Purchase): Map<string, number> {
  const totals = new Map<string, number>();
  const add = (lineId: string, value: number) => totals.set(lineId, (totals.get(lineId) ?? 0) + value);
  for (const allocation of purchase.costAllocations ?? []) {
    if (allocation.saleExpenseCents) add(allocation.lineId, allocation.saleExpenseCents);
  }
  for (const adjustment of purchase.saleCostAdjustments ?? []) {
    for (const allocation of adjustment.allocations ?? []) add(allocation.lineId, allocation.saleExpenseCents);
  }
  return totals;
}

/** Exact total of sale-side cents attributed to pieces (reception + adjustments). */
export function purchaseSaleExpenseTotalCents(purchase: Purchase): number {
  let sum = 0;
  for (const value of effectiveSaleExpenseCents(purchase).values()) sum += value;
  return sum;
}

/** Sale-side cents per product across the trip (folds repeated product lines). */
export function purchaseProductSaleCosts(purchase: Purchase): Map<string, { quantity: number; cents: number }> {
  const saleByLine = effectiveSaleExpenseCents(purchase);
  const byProduct = new Map<string, { quantity: number; cents: number }>();
  purchase.lines.forEach((line) => {
    if (!line.productId) return;
    const current = byProduct.get(line.productId) ?? { quantity: 0, cents: 0 };
    byProduct.set(line.productId, {
      quantity: current.quantity + line.quantity,
      cents: current.cents + (saleByLine.get(line.lineId ?? "") ?? 0),
    });
  });
  return byProduct;
}

/** Latest purchase is one journey: repeated product lines fold within that purchase only. */
export function purchaseInventoryUpdates(products: Product[], purchase: Purchase): { stockUpdates: Map<string, ProductStockUpdate>; costAllocations?: PurchaseCostAllocation[] } {
  if (purchase.costingMethod !== "latest_purchase") return { stockUpdates: applyPurchaseLines(products, purchase.lines) };
  if (recalcPurchaseStatus(purchase) !== "ready") throw new Error("Revisa los productos y los totales de cada ticket antes de recibir.");
  if (purchase.sourcingExpenses?.some((expense) => !Number.isFinite(expense.amount) || expense.amount <= 0)) {
    throw new Error("Completa el importe de cada gasto antes de recibir.");
  }
  const costAllocations = purchaseCostAllocation(purchase);
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const line of purchase.lines) {
    const product = byId.get(line.productId);
    if (!product || product.storeId !== purchase.storeId) throw new Error("No se encontró un producto de esta tienda para recibir la compra.");
  }
  const bought = purchaseProductCosts(purchase, costAllocations);
  const stockUpdates = new Map<string, ProductStockUpdate>();
  for (const [id, value] of bought) {
    const previousQuantity = byId.get(id)!.quantityOnHand ?? 0;
    const quantityOnHand = previousQuantity + value.quantity;
    if (!Number.isSafeInteger(previousQuantity) || !Number.isSafeInteger(quantityOnHand)) throw new Error("Revisa las existencias del producto antes de recibir.");
    stockUpdates.set(id, { quantityOnHand, cost: value.cents / value.quantity / 100 });
  }
  return { stockUpdates, costAllocations };
}

export function purchaseProductCosts(purchase: Purchase, allocations = purchaseCostAllocation(purchase)): Map<string, { quantity: number; cents: number }> {
  const bought = new Map<string, { quantity: number; cents: number }>();
  purchase.lines.forEach((line, index) => {
    if (!line.productId) return;
    const current = bought.get(line.productId) ?? { quantity: 0, cents: 0 };
    const next = { quantity: current.quantity + line.quantity, cents: current.cents + allocations[index].totalCents };
    if (!Number.isSafeInteger(next.quantity) || !Number.isSafeInteger(next.cents)) throw new Error("La compra supera el límite de cantidades o importes.");
    bought.set(line.productId, next);
  });
  return bought;
}

/** #265: in-memory reconciliation after receivePurchaseTx commits — built
 * EXCLUSIVELY from the updates the transaction applied (exact latest_purchase
 * cost), never from a local approximation like the weighted average. */
export function receivedProductsFromStockUpdates(
  products: Product[],
  stockUpdates: Map<string, ProductStockUpdate>,
  at: string
): Product[] {
  const received: Product[] = [];
  for (const [productId, update] of stockUpdates) {
    const product = products.find((p) => p.id === productId);
    if (product) received.push({ ...product, ...update, updatedAt: at });
  }
  return received;
}
