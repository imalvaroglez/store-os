// @vitest-environment jsdom
// #267 — one-tap "Cobrar" charges the NET pending amount: saldo a favor from a
// sister order is never counted as cash on this one.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrderCard } from "./OrderCard";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Order } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  upsertOrder: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      upsertOrder: mocks.upsertOrder,
      consumeSupply: vi.fn(),
      registerIncidentEvent: vi.fn(),
    }),
  };
});

function order(overrides: Partial<Order>): Order {
  return {
    id: "o_credit",
    storeId: "store_olivia",
    customerId: "",
    items: [{ productName: "Reloj", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
    deposit: 0,
    orderStatus: "ready",
    paymentStatus: "partial",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    ...overrides,
  } as Order;
}

beforeEach(() => {
  mocks.state = fixtureState();
  mocks.upsertOrder.mockReset();
});

async function clickCobrar() {
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
}

describe("OrderCard · Cobrar de un toque (#267)", () => {
  it("con saldo a favor aplicado cobra el NETO, no el bruto", async () => {
    const withCredit = order({ creditAppliedCents: 40000 });
    mocks.upsertOrder.mockImplementation(async (saved: Order) => ({ ...saved }));
    render(<ToastProvider><OrderCard order={withCredit} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    expect(mocks.upsertOrder).toHaveBeenCalledTimes(1);
    const saved = mocks.upsertOrder.mock.calls[0][0] as Order;
    expect(saved.deposit).toBe(600); // 1000 − 400 de saldo a favor
    expect(await screen.findByText("Pedido cobrado")).toBeTruthy();
  });

  it("con anticipo previo suma el NETO sobre el anticipo (no lo repite ni lo pisa)", async () => {
    const withBoth = order({ deposit: 300, creditAppliedCents: 40000 });
    mocks.upsertOrder.mockImplementation(async (saved: Order) => ({ ...saved }));
    render(<ToastProvider><OrderCard order={withBoth} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    const saved = mocks.upsertOrder.mock.calls[0][0] as Order;
    expect(saved.deposit).toBe(600); // 300 previos (ya cuentan como recibido) + 300 netos
  });

  it("con reembolso por incidencia cobra el total EFECTIVO", async () => {
    const withRefund = order({
      incidents: [{ id: "inc_1", productName: "Pieza", quantity: 1, reason: "Defecto", originalUnitPriceCents: 20000, resolution: { kind: "refund" as const, saleAdjustmentUnitCents: 20000 }, events: [] }],
    });
    mocks.upsertOrder.mockImplementation(async (saved: Order) => ({ ...saved }));
    render(<ToastProvider><OrderCard order={withRefund} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    const saved = mocks.upsertOrder.mock.calls[0][0] as Order;
    expect(saved.deposit).toBe(800); // 1000 − 200 de reembolso
  });

  it("sin saldo a favor conserva el comportamiento anterior (total completo)", async () => {
    mocks.upsertOrder.mockImplementation(async (saved: Order) => ({ ...saved }));
    render(<ToastProvider><OrderCard order={order({})} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    const saved = mocks.upsertOrder.mock.calls[0][0] as Order;
    expect(saved.deposit).toBe(1000);
    expect(await screen.findByText("Pedido cobrado")).toBeTruthy();
  });
});
