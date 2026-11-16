import { describe, expect, it } from "vitest";
import { pendingQueues, type QueueInputs } from "./closeQueues";
import type { Customer, Order } from "../types";

// #457 — the review QUEUE: grouped by cause, with classification (periodo por
// determinar vs afecta este mes), counts that never claim false zeros, and
// deep links to the origin entity. Derived from the SAME coverage data the
// dashboard shows — no second source of truth.

const NOW = "2026-11-14T10:00:00.000Z";
const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, storeId: "s1", customerId: "c1",
  items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 300, subtotal: 300 }],
  deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
  createdAt: NOW, updatedAt: NOW, ...extra,
} as Order);

const customers: Customer[] = [
  { id: "c1", storeId: "s1", name: "Lucía", createdAt: NOW, updatedAt: NOW },
] as Customer[];

const inputs = (over: Partial<QueueInputs> = {}): QueueInputs => ({
  storeId: "s1",
  month: { year: 2026, month: 11 },
  coverage: {
    deliveredWithoutDate: [
      { orderId: "order_demo01", reference: "#DEMO01" },
      { orderId: "order_demo02", reference: "#DEMO02" },
    ],
    linesWithoutCost: [
      { orderId: "order_nov5", reference: "#NOV5", productName: "Accesorio demo", quantity: 2 },
    ],
    unconfirmedCollections: [
      { orderId: "order_nov5", reference: "#NOV5", paymentId: "pay_x", amountCents: 17000 },
    ],
    deliveredWithoutLine: [],
    unreadableData: [],
    complete: false,
  },
  orders: [
    order("order_demo01", { customerId: "c1", orderStatus: "delivered" }),
    order("order_demo02", { customerId: "c9", orderStatus: "delivered" }),
    order("order_nov5"),
  ],
  customers,
  ...over,
});

describe("pendingQueues (#457)", () => {
  it("tres colas con conteo por revisar y clasificación de afectación del mes", () => {
    const queues = pendingQueues(inputs());
    expect(queues.pedidosSinFecha.total).toBe(2);
    expect(queues.cobrosSinFecha.total).toBe(1);
    expect(queues.sinCosto.total).toBe(1);
    // «X atribuibles aún al mes» = DESCONOCIDO mientras no haya evidencia:
    // jamás un «0 afectan noviembre» sin prueba.
    expect(queues.pedidosSinFecha.mesDesconocido).toBe(2);
    expect(queues.pedidosSinFecha.atribuidosAlMes).toBe(0);
  });

  it("cada fila habla humano: folio + clienta cuando existe + concepto, y lleva enlace al origen", () => {
    const queues = pendingQueues(inputs());
    const row = queues.pedidosSinFecha.rows[0];
    expect(row).toMatchObject({ reference: "#DEMO01", customerName: "Lucía", linkPath: "/pedidos" });
    expect(row.concept).toMatch(/Entregado legacio|entregado legado|Fecha efectiva desconocida/i);
    // Clienta desconocida no deja el campo vacío-engadoso.
    expect(queues.pedidosSinFecha.rows[1].customerName).toBe("Sin clienta");
    const cobro = queues.cobrosSinFecha.rows[0];
    expect(cobro).toMatchObject({ reference: "#NOV5", amountCents: 17000, concept: /sin fecha/i, linkPath: "/pedidos" });
    const costo = queues.sinCosto.rows[0];
    expect(costo).toMatchObject({ reference: "#NOV5", productName: "Accesorio demo", quantity: 2, linkPath: "/productos" });
  });

  it("búsqueda y filtros de estado/afectación operan sobre las filas", () => {
    const queues = pendingQueues(inputs());
    expect(queues.pedidosSinFecha.rows.filter((r) => r.customerName.includes("Lucía"))).toHaveLength(1);
    expect(queues.cobrosSinFecha.rows.filter((r) => r.status === "pendiente")).toHaveLength(1);
  });

  it("aislamiento por tienda: pedidos de otra tienda no alimentan la cola", () => {
    const foreign = order("order_for", { storeId: "otra", orderStatus: "delivered" });
    const queues = pendingQueues(inputs({
      coverage: { ...inputs().coverage, deliveredWithoutDate: [{ orderId: "order_for", reference: "#FOR" }] },
      orders: [foreign],
    }));
    expect(queues.pedidosSinFecha.total).toBe(0);
  });
});
