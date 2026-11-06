// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Order, OrderPayment } from "../types";
import type { AppUser } from "./firebase/auth";

const hooks = vi.hoisted(() => ({
  user: null as AppUser | null,
  save: vi.fn(), load: vi.fn(), subscribe: vi.fn(), register: vi.fn(), fetch: vi.fn(),
  snapshot: null as ((state: AppState) => void) | null,
}));
vi.mock("./firebase/AuthProvider", () => ({ useAuth: () => ({ user: hooks.user }) }));
vi.mock("./firebase/config", () => ({ isFirebaseConfigured: () => true, FIREBASE_EMULATOR_ENABLED: false }));
vi.mock("../lib/storage", () => ({
  loadState: () => ({ stores: [], activeStoreId: null, products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [] }),
  loadPreferredStoreId: () => null, savePreferredStoreId: vi.fn(), saveState: vi.fn(),
}));
vi.mock("./firebase/firestoreData", async (importOriginal) => ({
  ...await importOriginal<typeof import("./firebase/firestoreData")>(),
  loadCloudState: hooks.load, subscribeCloudState: hooks.subscribe,
  registerOrderPaymentTx: hooks.register, fetchOrderPayments: hooks.fetch, saveOrderWithStockTx: hooks.save,
  saveEntity: vi.fn().mockResolvedValue(undefined), projectPublicForStore: vi.fn().mockResolvedValue(undefined),
}));
import { StoreProvider, useStore } from "./StoreProvider";
import type { OrderPaymentsResult } from "./firebase/firestoreData";
import { docReceivedCents } from "../features/orders/payments";

const order: Order = {
  id: "retry-order", storeId: "retry-store", customerId: "test-customer", deposit: 0,
  items: [{ productName: "Pieza de prueba", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
  orderStatus: "confirmed", paymentStatus: "unpaid", revision: 1,
  createdAt: "2026-11-03", updatedAt: "2026-11-03",
};
const state = (): AppState => ({
  stores: [{ id: "retry-store", name: "Tienda de prueba", slug: "retry-store", type: "on_demand", createdAt: "2026-11-03", updatedAt: "2026-11-03" }],
  activeStoreId: "retry-store", products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [order], expenses: [],
});
const receipt: OrderPayment = {
  id: "same-intent", orderId: order.id, storeId: order.storeId, amount: 400, kind: "payment", method: "cash",
  date: "2026-11-03", createdAt: "2026-11-03T10:00:00Z", createdBy: "operator-a",
};
const input = { id: receipt.id, kind: "payment" as const, amountText: "400", method: "cash" as const, date: "2026-11-03" };
let context: ReturnType<typeof useStore>;
let nextAccountCounts: number[] = [];
function Probe() {
  context = useStore();
  if (hooks.user?.uid === "operator-b") nextAccountCounts.push(context.payments.length);
  return <><span data-testid="received">{docReceivedCents(context.state.orders[0] ?? {})}</span><span data-testid="records">{context.payments.length}</span></>;
}
async function mount() {
  const view = render(<StoreProvider><Probe /></StoreProvider>);
  await waitFor(() => expect(context.state.orders).toHaveLength(1));
  return view;
}

beforeEach(() => {
  nextAccountCounts = [];
  hooks.user = { uid: "operator-a", role: "member", email: "operator-a@example.test" } as AppUser;
  hooks.load.mockReset().mockResolvedValue(state());
  hooks.register.mockReset(); hooks.fetch.mockReset();
  hooks.subscribe.mockReset().mockImplementation((_user, callback) => { hooks.snapshot = callback; return () => {}; });
});

describe("confirmed payment display", () => {
  it("does not add an existing receipt again on a retry", async () => {
    hooks.register.mockResolvedValue({ payments: [receipt], order: { ...order, paymentsReceivedCents: 40000, paymentsRevision: 1 } });
    await mount();
    await act(async () => context.registerOrderPayment(context.state.orders[0], input));
    expect(screen.getByTestId("received")).toHaveTextContent("40000");
    await act(async () => context.registerOrderPayment(context.state.orders[0], input));
    expect(screen.getByTestId("received")).toHaveTextContent("40000");
    expect(context.payments).toHaveLength(1);
  });

  it("drops a registration response from a previous account", async () => {
    let finish!: (value: OrderPaymentsResult) => void;
    hooks.register.mockReturnValue(new Promise<OrderPaymentsResult>((resolve) => { finish = resolve; }));
    const view = await mount();
    const pending = context.registerOrderPayment(context.state.orders[0], input);
    hooks.user = { uid: "operator-b", role: "member", email: "operator-b@example.test" } as AppUser;
    hooks.load.mockResolvedValue({ ...state(), stores: [], activeStoreId: null, orders: [], expenses: [] });
    view.rerender(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { finish({ payments: [receipt], order: { ...order, paymentsReceivedCents: 40000, paymentsRevision: 1 } }); await pending; });
    expect(screen.getByTestId("records")).toHaveTextContent("0");
  });
});

describe("payment response ordering", () => {
  it("keeps the newer adjustment when an older response and a stale cloud load arrive later", async () => {
    let finishOld!: (result: OrderPaymentsResult) => void;
    hooks.register.mockReturnValueOnce(new Promise<OrderPaymentsResult>((resolve) => { finishOld = resolve; }));
    hooks.register.mockResolvedValueOnce({
      payments: [{ ...receipt, id: "adjustment", amount: -150, kind: "adjustment", method: "unknown", note: "Corrección" }],
      order: { ...order, paymentsRevision: 2, paymentsReceivedCents: 25000, lastPaymentId: "adjustment" },
    });
    await mount();
    const old = context.registerOrderPayment(context.state.orders[0], input);
    await act(async () => context.registerOrderPayment(context.state.orders[0], { kind: "adjustment", id: "adjustment", direction: "subtract", amountText: "150", note: "Corrección" }));
    expect(screen.getByTestId("received")).toHaveTextContent("25000");
    await act(async () => {
      finishOld({ payments: [receipt], order: { ...order, paymentsRevision: 1, paymentsReceivedCents: 40000 } });
      await old;
      hooks.snapshot?.({ ...state(), orders: [{ ...order, paymentsRevision: 1, paymentsReceivedCents: 40000 }] });
    });
    expect(screen.getByTestId("received")).toHaveTextContent("25000");
    expect(context.payments).toHaveLength(2);
  });

  it("keeps newer business edits and ignores a response for a removed order", async () => {
    let finish!: (result: OrderPaymentsResult) => void;
    hooks.register.mockReturnValueOnce(new Promise<OrderPaymentsResult>((resolve) => { finish = resolve; }));
    await mount();
    const pending = context.registerOrderPayment(context.state.orders[0], input);
    await act(async () => hooks.snapshot?.({ ...state(), orders: [{ ...order, revision: 3, notes: "Nota más reciente", paymentsRevision: 1, paymentsReceivedCents: 40000 }] }));
    await act(async () => { finish({ payments: [receipt], order: { ...order, paymentsRevision: 1, paymentsReceivedCents: 40000 } }); await pending; });
    expect(context.state.orders[0].notes).toBe("Nota más reciente");
    hooks.register.mockResolvedValueOnce({ payments: [receipt], order: { ...order, paymentsRevision: 2, paymentsReceivedCents: 40000 } });
    const stillOpen = context.registerOrderPayment(context.state.orders[0], input);
    await act(async () => { hooks.snapshot?.({ ...state(), orders: [] }); await stillOpen; });
    expect(context.state.orders).toHaveLength(0);
  });

  it("drops a receipt history response from a previous account", async () => {
    let finish!: (result: OrderPaymentsResult) => void;
    hooks.fetch.mockReturnValueOnce(new Promise<OrderPaymentsResult>((resolve) => { finish = resolve; }));
    const view = await mount();
    const pending = context.loadOrderPayments(order.id);
    hooks.user = { uid: "operator-b", role: "member", email: "operator-b@example.test" } as AppUser;
    hooks.load.mockResolvedValue({ ...state(), stores: [], orders: [], activeStoreId: null });
    view.rerender(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { finish({ payments: [receipt], order: { ...order, paymentsRevision: 1, paymentsReceivedCents: 40000 } }); await pending; });
    expect(context.payments).toHaveLength(0);
  });
});


it("never exposes the previous account's already-loaded receipts during the new account render", async () => {
  hooks.register.mockResolvedValue({ payments: [receipt], order: { ...order, paymentsRevision: 1, paymentsReceivedCents: 40000 } });
  const view = await mount();
  await act(async () => context.registerOrderPayment(context.state.orders[0], input));
  expect(context.payments).toHaveLength(1);
  hooks.user = { uid: "operator-b", role: "member", email: "operator-b@example.test" } as AppUser;
  hooks.load.mockResolvedValue({ ...state(), stores: [], orders: [], activeStoreId: null });
  view.rerender(<StoreProvider><Probe /></StoreProvider>);
  await waitFor(() => expect(context.state.orders).toHaveLength(0));
  expect(nextAccountCounts.length).toBeGreaterThan(0);
  expect(nextAccountCounts.every((count) => count === 0)).toBe(true);
});


it("returns the canonical saved order so a caller can detect a pinned deposit (#218)", async () => {
  const canonical = { ...order, deposit: 0, paymentsReceivedCents: 59000, revision: 2 };
  hooks.save.mockResolvedValue({ order: canonical, stock: [] });
  await mount();
  let saved: unknown;
  await act(async () => { saved = await context.upsertOrder({ ...order, deposit: 1000 }); });
  expect(saved).toEqual(canonical);
  expect(context.state.orders[0]).toMatchObject(canonical);
});
