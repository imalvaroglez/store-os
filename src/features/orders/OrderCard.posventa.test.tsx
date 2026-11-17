// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderCard } from "./OrderCard";
import { ToastProvider } from "../../design-system";
import type { Order } from "../../types";

// #455 r3 (UX): after a CONFIRMED posventa adjustment the card reconciles
// with the close — the note under Total ends the "three surfaces, two totals".

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return { ...actual, useStore: () => ({ state: { stores: [], orders: [], payments: [], customers: [], purchases: [], products: [] }, activeStore: null }) };
});

const baseOrder: Order = {
  id: "o_r3",
  storeId: "store_olivia",
  customerId: "",
  items: [{ productName: "Reloj", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
  deposit: 0,
  orderStatus: "ready",
  paymentStatus: "partial",
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
} as unknown as Order;

describe("#455 r3 — tarjeta conciliada con posventa", () => {
  it("tras devolución confirmada, la tarjeta anota «Incluye −$500.00 de posventa confirmada» bajo el Total", async () => {
    const refunded = {
      ...baseOrder,
      incidents: [{
        id: "i1", orderId: "o_r3", storeId: "store_olivia",
        productId: "p1", productName: "Reloj", quantity: 1, reason: "defecto", originalUnitPriceCents: 50000,
        status: "resolved", createdAt: "", createdBy: "u1",
        events: [{ id: "e1", kind: "confirmed", at: "2026-11-20T10:00:00.000Z", by: "u1" }],
        resolution: { kind: "refund", saleAdjustmentUnitCents: 50000, refundOwedCents: 50000 },
      }],
    } as unknown as Order;
    render(<ToastProvider><OrderCard order={refunded} onEdit={() => {}} /></ToastProvider>);
    expect(await screen.findByText(/Incluye −\$500\.00 de posventa confirmada/)).toBeTruthy();
  });

  it("sin posventa confirmada, la tarjeta no muestra la nota", () => {
    render(<ToastProvider><OrderCard order={baseOrder} onEdit={() => {}} /></ToastProvider>);
    expect(screen.queryByText(/de posventa confirmada/)).toBeNull();
  });
});
