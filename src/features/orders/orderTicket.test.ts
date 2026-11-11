import { describe, expect, it } from "vitest";
import { orderTicketText, receiptFileName } from "./orderTicket";
import type { Order } from "../../types";

describe("orderTicketText — Fer's WhatsApp format", () => {
  it("renders her exact message: bold header, category groups with running numbers, Total and Saldo", () => {
    const order: Order = { id: "order_4ddabf", storeId: "s1", customerId: "c1", customerName: "Michelle Vargas", items: [
      { productName: "Huggies Mezcalita Gold", quantity: 1, unitPrice: 60, subtotal: 60, categorySnapshot: { id: "earrings", name: "Aretes" }, cost: 20 },
      { productName: "Huggies Mezcalita Silver", quantity: 1, unitPrice: 50, subtotal: 50, categorySnapshot: { id: "earrings", name: "Aretes" } },
      { productName: "Reloj Toscana Gold", quantity: 1, unitPrice: 160, subtotal: 160, categorySnapshot: { id: "watches", name: "Reloj" } },
    ], deposit: 50, orderStatus: "quoted", paymentStatus: "partial", notes: "Privado", createdAt: "2026-11-06", updatedAt: "" };
    expect(orderTicketText(order, "Olivia", "Nombre actual")).toBe([
      "*Detalle de pedido #4DDABF*",
      "*Tienda:* Olivia",
      "*Cliente:* Michelle Vargas",
      "*Estado:* Cotizado",
      "*Fecha:* 6 de noviembre, 2026",
      "",
      "*Aretes*",
      "1. Huggies Mezcalita Gold $60",
      "2. Huggies Mezcalita Silver $50",
      "*Reloj*",
      "3. Reloj Toscana Gold $160",
      "",
      "*Total* $270",
      "*Saldo* $220",
    ].join("\n"));
    // Private notes and costs never appear; the store now travels in the header.
  });

  it("keeps uncategorized lines last with numbers in reading order, and prefixes quantities over one", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", customerName: "Mar", items: [
      { productName: "Encargo especial", quantity: 1, unitPrice: 50, subtotal: 50 },
      { productName: "Anillo", quantity: 3, unitPrice: 0.335, subtotal: 1.01, categorySnapshot: { id: "rings", name: "Anillos" } },
      { productName: "Pulsera torzal", quantity: 1, unitPrice: 40, subtotal: 40, categorySnapshot: { id: "rings", name: "Anillos" } },
    ], deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid", createdAt: "2026-11-04", updatedAt: "" };
    expect(orderTicketText(order, "Olivia")).toBe([
      "*Detalle de pedido #O1*",
      "*Tienda:* Olivia",
      "*Cliente:* Mar",
      "*Estado:* Confirmado",
      "*Fecha:* 4 de noviembre, 2026",
      "",
      "*Anillos*",
      "1. 3 × Anillo $1.01",
      "2. Pulsera torzal $40",
      "*Sin categoría*",
      "3. Encargo especial $50",
      "",
      "*Total* $91.01",
    ].join("\n"));
  });

  it("falls back to the passed name, then to Sin cliente", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "A", quantity: 1, unitPrice: 10, subtotal: 10 }], deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-11-04", updatedAt: "" };
    expect(orderTicketText(order, "Olivia", "Mar")).toContain("*Cliente:* Mar");
    expect(orderTicketText({ ...order, customerName: "" }, "Olivia")).toContain("*Cliente:* Sin cliente");
  });

  it("omits the Fecha line when the order has no parseable date", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", customerName: "Mar", items: [{ productName: "A", quantity: 1, unitPrice: 10, subtotal: 10 }], deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", createdAt: "", updatedAt: "" };
    expect(orderTicketText(order, "Olivia")).toBe([
      "*Detalle de pedido #O1*",
      "*Tienda:* Olivia",
      "*Cliente:* Mar",
      "*Estado:* Preguntó",
      "",
      "*Sin categoría*",
      "1. A $10",
      "",
      "*Total* $10",
    ].join("\n"));
  });

  it("drops Saldo (and any payment line) when nothing is owed, even with an excess advance", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "A", quantity: 1, unitPrice: 40, subtotal: 40 }], deposit: 50, orderStatus: "asked", paymentStatus: "paid", createdAt: "2026-11-04", updatedAt: "" };
    const ticket = orderTicketText(order, "Olivia");
    expect(ticket).toContain("*Total* $40");
    expect(ticket).toContain("*A tu favor* $10");
    expect(ticket).not.toMatch(/^\*Saldo\* \$/m);
    expect(ticket).not.toContain("Recibido");
    expect(ticket).not.toContain("Anticipo");
    expect(ticket).not.toContain("Excedente");
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
    expect(ticket).toContain("*Total* $1,800");
    expect(ticket).toContain("*Saldo* $300");
  });

  it("strips literal asterisks from names so WhatsApp bold pairing survives", () => {
    const order: Order = { id: "o1", storeId: "s1", customerId: "c1", customerName: "Ana *Fer*", items: [
      { productName: "Aretes *dorados*", quantity: 1, unitPrice: 10, subtotal: 10, categorySnapshot: { id: "earrings", name: "Aretes *finos*" } },
    ], deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-11-06", updatedAt: "" };
    const ticket = orderTicketText(order, "Olivia *joyas*");
    expect(ticket).toContain("*Cliente:* Ana Fer");
    expect(ticket).toContain("*Tienda:* Olivia joyas");
    expect(ticket).toContain("*Aretes finos*");
    expect(ticket).toContain("1. Aretes dorados $10");
  });

  it("counts an unmaterialized inherited deposit once", () => {
    const order: Order = {
      id: "o3", storeId: "s1", customerId: "c1",
      items: [{ lineId: "l1", productName: "Arracada", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
      deposit: 400, orderStatus: "confirmed", paymentStatus: "partial",
      paymentsReceivedCents: 10000,
      createdAt: "2026-11-04", updatedAt: "",
    };
    expect(orderTicketText(order, "Olivia")).toContain("*Saldo* $500"); // $100 cobros + $400 anticipo aún sin materializar
    const materialized = { ...order, paymentsReceivedCents: 50000, inheritedDepositMaterialized: true as const };
    expect(orderTicketText(materialized, "Olivia")).toContain("*Saldo* $500"); // ya dentro del acumulado
  });
});

// #306 — importes legibles y saldo contextual (misma fuente canónica).
describe("orderTicketText · saldo contextual (#306)", () => {
  const order = (over: Partial<Order>): Order => ({
    id: "order_306", storeId: "s1", customerId: "c1", customerName: "Lucía",
    items: [{ productName: "Arracada Mimosa", quantity: 1, unitPrice: 770, subtotal: 770 }],
    deposit: 0, createdAt: "2026-11-10", updatedAt: "",
    ...over,
  }) as Order;

  it("sin abonos: solo Total, sin Saldo redundante", () => {
    const text = orderTicketText(order({}), "Olivia");
    expect(text).toContain("*Total* $770");
    expect(text).not.toContain("*Saldo*");
  });

  it("cobro parcial: Total y Saldo", () => {
    const text = orderTicketText(order({ deposit: 200 }), "Olivia");
    expect(text).toContain("*Total* $770");
    expect(text).toContain("*Saldo* $570");
  });

  it("liquidado: solo Total", () => {
    const text = orderTicketText(order({ deposit: 770 }), "Olivia");
    expect(text).toContain("*Total* $770");
    expect(text).not.toContain("*Saldo*");
  });

  it("excedente real: A tu favor, sin aparentar adeudo", () => {
    const text = orderTicketText(order({ deposit: 870 }), "Olivia");
    expect(text).toContain("*Total* $770");
    expect(text).toContain("*A tu favor* $100");
    expect(text).not.toMatch(/\*Saldo\* \$/);
  });

  it("$770.50 conserva los centavos; $770.00 se presenta $770", () => {
    const withCents = orderTicketText(order({
      items: [{ productName: "Arracada Mimosa", quantity: 1, unitPrice: 770.5, subtotal: 770.5 }],
    }), "Olivia");
    expect(withCents).toContain("$770.50");
    expect(orderTicketText(order({}), "Olivia")).not.toContain("$770.00");
  });
});

// Revisión adversarial #327: la posventa sin efectivo cambia la deuda real —
// ese Saldo NO se oculta, aunque no haya cobros.
describe("orderTicketText · incidencias sin efectivo (#306 revisión)", () => {
  const base = { id: "order_306i", storeId: "s1", customerId: "c1", customerName: "Lucía", createdAt: "2026-11-10", updatedAt: "" };
  const refund = { id: "inc1", productName: "Pieza", quantity: 1, reason: "Defecto", originalUnitPriceCents: 36000, resolution: { kind: "refund" as const, saleAdjustmentUnitCents: 36000 }, events: [] };

  it("reembolso por incidencia sin cobros: Total completo y Saldo real (≠ Total)", () => {
    const order = { ...base, items: [{ productName: "Arracada", quantity: 1, unitPrice: 720, subtotal: 720 }], deposit: 0, incidents: [refund] } as unknown as Order;
    const text = orderTicketText(order, "Olivia");
    expect(text).toContain("*Total* $720");
    expect(text).toContain("*Saldo* $360");
  });

  it("sin incidencias ni dinero: el Saldo no repite el Total (regla original #306)", () => {
    const order = { ...base, items: [{ productName: "Arracada", quantity: 1, unitPrice: 720, subtotal: 720 }], deposit: 0 } as unknown as Order;
    expect(orderTicketText(order, "Olivia")).not.toContain("*Saldo*");
  });
});

// #308 — nombre de archivo ordenable: referencia primero, luego clienta.
describe("receiptFileName (#308)", () => {
  it("referencia primero y clienta sanitizada", () => {
    expect(receiptFileName("order_4ddabf", "María José Pérez")).toBe("Pedido-4DDABF-Maria-Jose-Perez");
  });
  it("sin clienta queda sólo la referencia; vacío y espacios no rompen", () => {
    expect(receiptFileName("order_4ddabf")).toBe("Pedido-4DDABF");
    expect(receiptFileName("order_4ddabf", "   ")).toBe("Pedido-4DDABF");
  });
  it("nombre larguísimo se acota", () => {
    expect(receiptFileName("o1", "a".repeat(120)).length).toBeLessThanOrEqual("Pedido-O1-".length + 40);
  });
});

// Revisión adversarial #329: el corte de 40 no deja guion colgante.
describe("receiptFileName · corte limpio (#329 revisión)", () => {
  it("un corte a mitad de separador no termina en guion", () => {
    expect(receiptFileName("o1", "x".repeat(39) + " y")).not.toMatch(/-$/);
  });
});
