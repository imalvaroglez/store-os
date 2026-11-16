import type { Customer, Order } from "../types";
import type { MonthlyCloseCoverage } from "./monthlyClose";

// #457 — the review QUEUE behind the dashboard's three pending rows. Derived
// from the SAME coverage the close computes: no second source of truth, no
// invented dates/costs, no "0 affect this month" without evidence.

export type QueueStatus = "pendiente" | "revisado" | "clasificado_fuera_de_alcance";

export type QueueRow = {
  orderId: string;
  /** Payment id when the row is a specific cobro (stable React keys). */
  paymentId?: string;
  reference: string;
  customerName: string;
  concept: string;
  productName?: string;
  quantity?: number;
  amountCents?: number;
  status: QueueStatus;
  /** Unknown until evidence says otherwise — never a false zero. */
  affectsMonth: "desconocido" | "si" | "no";
  linkPath: string;
};

export type Queue = {
  total: number;
  /** Rows whose period attribution is UNKNOWN (not "proven outside"). */
  mesDesconocido: number;
  atribuidosAlMes: number;
  rows: QueueRow[];
};

export type QueueInputs = {
  storeId: string;
  month: { year: number; month: number };
  coverage: MonthlyCloseCoverage;
  orders: Order[];
  customers: Customer[];
};

function nameOf(customers: Customer[], customerId: string | undefined): string {
  return customers.find((c) => c.id === customerId)?.name ?? "Sin clienta";
}

/** Pure derivation of the three review queues from close coverage. */
export function pendingQueues(inputs: QueueInputs): {
  pedidosSinFecha: Queue;
  cobrosSinFecha: Queue;
  sinCosto: Queue;
} {
  const { coverage, orders, customers } = inputs;
  const byId = new Map(orders.map((o) => [o.id, o]));

  // Defensive store isolation: coverage is already store-scoped upstream, but
  // a foreign order handed here can never feed the queue.
  const inStore = (orderId: string) => {
    const order = byId.get(orderId);
    return !order || order.storeId === inputs.storeId;
  };

  const pedidos: QueueRow[] = coverage.deliveredWithoutDate.filter((entry) => inStore(entry.orderId)).map((entry) => {
    const order = byId.get(entry.orderId);
    return {
      orderId: entry.orderId,
      reference: entry.reference,
      customerName: nameOf(customers, order?.customerId),
      concept: "Entregado legado · fecha efectiva desconocida",
      status: "pendiente" as const,
      affectsMonth: "desconocido" as const,
      linkPath: `/pedidos/${entry.orderId}`,
    };
  });

  const cobros: QueueRow[] = coverage.unconfirmedCollections.filter((entry) => inStore(entry.orderId)).map((entry) => ({
    orderId: entry.orderId,
    paymentId: entry.paymentId,
    reference: entry.reference,
    customerName: nameOf(customers, byId.get(entry.orderId)?.customerId),
    concept: "Cobro sin fecha verificable («Fecha por confirmar»)",
    amountCents: entry.amountCents,
    status: "pendiente" as const,
    affectsMonth: "desconocido" as const,
    // #457 r2: DEEP link — never force re-searching a folio the row shows.
    linkPath: `/pedidos/${entry.orderId}`,
  }));

  const costos: QueueRow[] = coverage.linesWithoutCost.filter((entry) => inStore(entry.orderId)).map((entry) => ({
    orderId: entry.orderId,
    reference: entry.reference,
    customerName: nameOf(customers, byId.get(entry.orderId)?.customerId),
    concept: "Vendido sin costo conocido — el costo no se inventa",
    productName: entry.productName,
    quantity: entry.quantity,
    status: "pendiente" as const,
    affectsMonth: "desconocido" as const,
    linkPath: "/productos",
  }));

  // #457 r2: "sin costo" counts PIECES (what the dashboard row shows), not
  // lines — one number, one meaning across surfaces.
  const sinCostoTotal = costos.reduce((sum, row) => sum + (row.quantity ?? 1), 0);
  const queue = (rows: QueueRow[], total = rows.length): Queue => ({
    total,
    mesDesconocido: rows.filter((r) => r.affectsMonth === "desconocido").length,
    atribuidosAlMes: rows.filter((r) => r.affectsMonth === "si").length,
    rows,
  });

  return { pedidosSinFecha: queue(pedidos), cobrosSinFecha: queue(cobros), sinCosto: queue(costos, sinCostoTotal) };
}
