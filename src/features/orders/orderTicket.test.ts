import { describe, expect, it } from "vitest";
import { orderTicketText } from "./orderTicket";
import type { Order } from "../../types";

describe("orderTicketText", () => {
  it("uses saved categories, customer and exact amounts, without private details", () => {
    const order: Order = { id: "order-123", storeId: "s1", customerId: "c1", customerName: "Sofía", items: [
      { productName: "Anillo", quantity: 3, unitPrice: 0.335, subtotal: 1.01, categorySnapshot: { id: "rings", name: "Anillos" }, cost: 0.1 },
      { productName: "Encargo", quantity: 1, unitPrice: 0.2, subtotal: 0.2 },
    ], deposit: 0.4, orderStatus: "confirmed", paymentStatus: "partial", notes: "Privado", createdAt: "", updatedAt: "" };
    const ticket = orderTicketText(order, "Olivia", "Nombre actual");
    expect(ticket).toContain("Cliente: Sofía");
    expect(ticket).toContain("Anillos\n• 3 × Anillo — $0.335 c/u = $1.01");
    expect(ticket).toContain("Sin categoría\n• 1 × Encargo");
    expect(ticket).toContain("Total: $1.21");
    expect(ticket).toContain("Anticipo registrado: $0.40");
    expect(ticket).toContain("Saldo: $0.81");
    expect(ticket).not.toContain("Privado");
    expect(ticket).not.toContain("Nombre actual");
  });
  it("reports an advance greater than the total", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "A", quantity: 1, unitPrice: 40, subtotal: 40 }], deposit: 50, orderStatus: "asked", paymentStatus: "paid", createdAt: "", updatedAt: "" };
    expect(orderTicketText(order, "Olivia")).toContain("Anticipo mayor al total: $10.00");
  });
});
