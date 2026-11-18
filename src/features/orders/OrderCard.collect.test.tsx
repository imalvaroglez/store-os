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
      payments: [],
      loadOrderPayments: vi.fn(async () => {}),
      registerOrderPayment: vi.fn(async () => {}),
      draftOwnerId: "qa-user",
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

describe("OrderCard · Cobrar de un toque (#267 → #279 r3 B1: evidencia válida)", () => {
  async function prefillAmount(): Promise<string> {
    const amount = await screen.findByLabelText(/Monto/i);
    return (amount as HTMLInputElement).value;
  }

  it("con saldo a favor aplicado prellena el NETO, no el bruto", async () => {
    const withCredit = order({ creditAppliedCents: 40000 });
    mocks.state = { ...fixtureState(), orders: [withCredit] } as never;
    render(<ToastProvider><OrderCard order={withCredit} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    expect(await screen.findByText(/Cobros del pedido/i)).toBeTruthy();
    expect(await prefillAmount()).toBe("600"); // 1000 − 400 de saldo a favor
    expect(mocks.upsertOrder).not.toHaveBeenCalled(); // sin anticipo mudo
  });

  it("con anticipo previo prellena el NETO pendiente (no repite ni pisa el anticipo)", async () => {
    const withBoth = order({ deposit: 300, creditAppliedCents: 40000 });
    mocks.state = { ...fixtureState(), orders: [withBoth] } as never;
    render(<ToastProvider><OrderCard order={withBoth} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    expect(await prefillAmount()).toBe("300"); // 1000 − 300 ya recibidos − 400 de saldo
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });

  it("con reembolso por incidencia prellena el total EFECTIVO", async () => {
    const withRefund = order({
      incidents: [{ id: "inc_1", productName: "Pieza", quantity: 1, reason: "Defecto", originalUnitPriceCents: 20000, resolution: { kind: "refund" as const, saleAdjustmentUnitCents: 20000 }, events: [] }],
    });
    mocks.state = { ...fixtureState(), orders: [withRefund] } as never;
    render(<ToastProvider><OrderCard order={withRefund} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    expect(await prefillAmount()).toBe("800"); // 1000 − 200 de reembolso
  });

  it("sin saldo a favor prellena el total completo", async () => {
    mocks.state = fixtureState();
    render(<ToastProvider><OrderCard order={order({})} onEdit={() => {}} /></ToastProvider>);
    await clickCobrar();
    expect(await prefillAmount()).toBe("1000");
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });
});

describe("#279 r3 B1 — el cobro exprés alimenta la caja con evidencia válida", () => {
  beforeEach(() => {
    mocks.upsertOrder.mockReset();
  });

  it("«Cobrar» abre la hoja de Cobros con el monto neto PRELLENADO y NO escribe un anticipo sin recibo", async () => {
    const target = order({ deposit: 0, items: [{ productName: "Reloj", quantity: 1, unitPrice: 500, subtotal: 500 }] });
    mocks.state = { ...fixtureState(), orders: [target] } as never;
    render(<ToastProvider><OrderCard order={target} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    // La hoja se abre (título visible) con el monto listo para confirmar con
    // método y fecha — evidencia de cobro válida, jamás anticipo mudo.
    expect(await screen.findByText(/Cobros del pedido/i)).toBeTruthy();
    const amount = await screen.findByLabelText(/Monto/i);
    expect((amount as HTMLInputElement).value).toBe("500");
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });
});
