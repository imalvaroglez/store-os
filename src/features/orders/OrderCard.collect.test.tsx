// @vitest-environment jsdom
// #267 — one-tap "Cobrar" charges the NET pending amount: saldo a favor from a
// sister order is never counted as cash on this one.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrderCard } from "./OrderCard";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Order } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  upsertOrder: vi.fn(),
  registerOrderPayment: vi.fn(async (_order: Order, _input: unknown) => {}),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      upsertOrder: mocks.upsertOrder,
      registerOrderPayment: mocks.registerOrderPayment,
      loadOrderPayments: vi.fn(async () => {}),
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
  mocks.registerOrderPayment.mockClear().mockImplementation(async () => {});
});

async function clickCobrar() {
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
}

describe("OrderCard · Cobrar de un toque (#267 / #455-458 r4)", () => {
  it("con saldo a favor aplicado cobra el NETO como pago REAL con fecha (no depósito)", async () => {
    const withCredit = order({ creditAppliedCents: 40000 });
    render(<ToastProvider><OrderCard order={withCredit} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    await waitFor(() => expect(mocks.registerOrderPayment).toHaveBeenCalledTimes(1));
    const input = mocks.registerOrderPayment.mock.calls[0]![1] as { kind: string; amountText: string; method: string; date?: string; id: string };
    expect(input.kind).toBe("payment");
    expect(input.amountText).toBe("600.00"); // 1000 − 400 de saldo a favor
    expect(input.method).toBe("cash");
    expect(typeof input.date).toBe("string"); // fecha capturada en el momento
    expect(mocks.upsertOrder).not.toHaveBeenCalled(); // jamás un bump de depósito
    expect(await screen.findByText("Pedido cobrado")).toBeTruthy();
  });

  it("con anticipo previo SIN materializar: guía a Cobros (no inventa la fecha del anticipo)", async () => {
    const withDeposit = order({ deposit: 300 });
    mocks.registerOrderPayment.mockRejectedValueOnce(new Error("Captura la fecha y el método del anticipo previo."));
    render(<ToastProvider><OrderCard order={withDeposit} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    expect(await screen.findByText(/anticipo previo sin fecha/i)).toBeTruthy();
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });

  it("con reembolso por incidencia cobra el total EFECTIVO", async () => {
    const withRefund = order({
      incidents: [{ id: "inc_1", productName: "Pieza", quantity: 1, reason: "Defecto", originalUnitPriceCents: 20000, resolution: { kind: "refund" as const, saleAdjustmentUnitCents: 20000 }, events: [] }],
    });
    render(<ToastProvider><OrderCard order={withRefund} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    await waitFor(() => expect(mocks.registerOrderPayment).toHaveBeenCalledTimes(1));
  expect((mocks.registerOrderPayment.mock.calls[0]![1] as { amountText: string }).amountText).toBe("800.00"); // 1000 − 200
  });

  it("el id de intento es estable por pedido e importe (reintento idempotente)", async () => {
    render(<ToastProvider><OrderCard order={order({})} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    await clickCobrar();
    await waitFor(() => expect(mocks.registerOrderPayment).toHaveBeenCalledTimes(2));
    const first = (mocks.registerOrderPayment.mock.calls[0]![1] as { id: string }).id;
    const second = (mocks.registerOrderPayment.mock.calls[1]![1] as { id: string }).id;
    expect(first).toBe(second); // el reintento ES el mismo intento
  });
});
