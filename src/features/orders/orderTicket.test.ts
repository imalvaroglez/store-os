import { describe, expect, it } from "vitest";
import { orderTicketText } from "./orderTicket";
import type { Order } from "../../types";

describe("orderTicketText — Fer's WhatsApp format", () => {
  it("matches her message shape: name + date, numbered pieces, Total — no private data", () => {
    const order: Order = { id: "order-123", storeId: "s1", customerId: "c1", customerName: "Fátima Bonilla", items: [
      { productName: "Reloj Silver caratula azul", quantity: 1, unitPrice: 200, subtotal: 200, categorySnapshot: { id: "watches", name: "Relojes" }, cost: 80 },
      { productName: "Anillo", quantity: 3, unitPrice: 0.335, subtotal: 1.01, cost: 0.1 },
    ], deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid", notes: "Privado", createdAt: "2026-10-31", updatedAt: "" };
    const ticket = orderTicketText(order, "Olivia", "Nombre actual");
    expect(ticket.split("\n")[0]).toBe("Fátima Bonilla 31 de octubre, 2026");
    expect(ticket).toContain("1. Reloj Silver caratula azul $200.00");
    expect(ticket).toContain("2. 3 × Anillo $1.01");
    expect(ticket).toContain("Total $201.01");
    expect(ticket).toContain("Saldo $201.01");
    expect(ticket).not.toContain("Privado");
    expect(ticket).not.toContain("Olivia"); // el mensaje es para la clienta, la tienda sobra
    expect(ticket).not.toContain("Nombre actual");
  });

  it("falls back to the passed name when the order has none", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "A", quantity: 1, unitPrice: 10, subtotal: 10 }], deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-11-04", updatedAt: "" };
    expect(orderTicketText(order, "Olivia", "Mar").split("\n")[0]).toBe("Mar 4 de noviembre, 2026");
  });

  it("drops the Saldo line when nothing is owed (advance beyond the total)", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "A", quantity: 1, unitPrice: 40, subtotal: 40 }], deposit: 50, orderStatus: "asked", paymentStatus: "paid", createdAt: "2026-11-04", updatedAt: "" };
    const ticket = orderTicketText(order, "Olivia");
    expect(ticket).toContain("Total $40.00");
    expect(ticket).not.toContain("Saldo");
  });

  it("computes Saldo from the doc accumulator for orders with cobros (#168 F4)", () => {
    // $1,500 received via registered cobros on a $1,800 order: the legacy
    // `deposit` is $0 and used to print "Saldo $1,800" with money in hand.
    const order: Order = {
      id: "o2", storeId: "s1", customerId: "c1",
      items: [{ lineId: "l1", productName: "Caja adviento", quantity: 1, unitPrice: 1800, subtotal: 1800 }],
      deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
      paymentsReceivedCents: 150000,
      createdAt: "2026-11-04", updatedAt: "",
    };
    const ticket = orderTicketText(order, "Olivia");
    expect(ticket).toContain("Total $1,800.00");
    expect(ticket).toContain("Saldo $300.00");
  });

  it("counts an unmaterialized inherited deposit once", () => {
    const order: Order = {
      id: "o3", storeId: "s1", customerId: "c1",
      items: [{ lineId: "l1", productName: "Arracada", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
      deposit: 400, orderStatus: "confirmed", paymentStatus: "partial",
      paymentsReceivedCents: 10000,
      createdAt: "2026-11-04", updatedAt: "",
    };
    expect(orderTicketText(order, "Olivia")).toContain("Saldo $500.00"); // $100 cobros + $400 anticipo aún sin materializar
    const materialized = { ...order, paymentsReceivedCents: 50000, inheritedDepositMaterialized: true as const };
    expect(orderTicketText(materialized, "Olivia")).toContain("Saldo $500.00"); // ya dentro del acumulado
  });
});
