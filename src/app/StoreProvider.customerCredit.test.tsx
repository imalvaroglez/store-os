// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Order } from "../types";
import type { AppUser } from "./firebase/auth";

const hooks = vi.hoisted(() => ({
  user: null as AppUser | null,
  load: vi.fn(), subscribe: vi.fn(), saveOrderTx: vi.fn(), apply: vi.fn(), release: vi.fn(),
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
  loadCloudState: hooks.load,
  subscribeCloudState: hooks.subscribe,
  applyCustomerCreditTx: hooks.apply,
  releaseCustomerCreditTx: hooks.release,
  saveOrderWithStockTx: hooks.saveOrderTx,
  saveEntity: vi.fn().mockResolvedValue(undefined), projectPublicForStore: vi.fn().mockResolvedValue(undefined),
}));
import { StoreProvider, useStore } from "./StoreProvider";

const creditor = (extra: Partial<Order> = {}): Order => ({
  id: "creditor", storeId: "s1", customerId: "clienta", deposit: 0,
  items: [{ productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }],
  paymentsReceivedCents: 11500, inheritedDepositMaterialized: true,
  orderStatus: "delivered", paymentStatus: "paid",
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...extra,
});
const debtor = (extra: Partial<Order> = {}): Order => ({
  id: "debtor", storeId: "s1", customerId: "clienta", deposit: 0,
  items: [{ productName: "Cadena", quantity: 1, unitPrice: 200, subtotal: 200 }],
  orderStatus: "confirmed", paymentStatus: "unpaid",
  createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", ...extra,
});
const stateWith = (orders: Order[]): AppState => ({
  stores: [{ id: "s1", name: "Tienda", slug: "tienda", type: "on_demand", createdAt: "", updatedAt: "" }],
  activeStoreId: "s1", products: [], categories: [], suppliers: [], purchases: [], customers: [], orders,
});

let context: ReturnType<typeof useStore>;
function Probe() {
  context = useStore();
  return <span data-testid="orders">{context.state.orders.length}</span>;
}
async function mount() {
  const view = render(<StoreProvider><Probe /></StoreProvider>);
  await waitFor(() => expect(hooks.load).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  hooks.snapshot = null;
  hooks.user = { uid: "operator-a", role: "member", email: "a@example.test" } as AppUser;
  hooks.load.mockReset().mockResolvedValue(stateWith([creditor(), debtor()]));
  hooks.subscribe.mockReset().mockImplementation((...args) => { hooks.snapshot = args[args.length - 1]; });
  hooks.apply.mockReset().mockResolvedValue(undefined);
  hooks.release.mockReset().mockResolvedValue(0);
  hooks.saveOrderTx.mockReset();
});

describe("automatic saldo a favor compensation (#189)", () => {
  it("applies the planned compensation once the state is ready, then stops when the plan is empty", async () => {
    await mount();
    // Effect fires with the ready state: one application, creditor → debtor, $15.
    await waitFor(() => expect(hooks.apply).toHaveBeenCalledTimes(1));
    const call = hooks.apply.mock.calls[0][0];
    expect(call.orderId).toBe("debtor");
    expect(call.storeId).toBe("s1");
    expect(call.entry.kind).toBe("application");
    expect(call.entry.fromOrderId).toBe("creditor");
    expect(call.entry.amountCents).toBe(1500);
    expect(call.entry.by).toBe("operator-a");
    // The listener round-trip lands the canonical docs: plan empty → no more writes.
    await act(async () => {
      hooks.snapshot?.(stateWith([
        { ...creditor(), creditConsumedCents: 1500 },
        { ...debtor(), creditAppliedCents: 1500 },
      ]));
    });
    await act(async () => { await Promise.resolve(); });
    expect(hooks.apply).toHaveBeenCalledTimes(1);
  });

  it("does not write when there is nothing to compensate", async () => {
    hooks.load.mockResolvedValue(stateWith([debtor()]));
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(hooks.apply).not.toHaveBeenCalled();
  });

  it("keeps one write per pass and follows up with the fresh state (remainder chains)", async () => {
    hooks.load.mockResolvedValue(stateWith([
      creditor(),
      { ...debtor(), id: "debtor-old", createdAt: "2026-11-02T09:00:00Z" },
      { ...debtor(), id: "debtor-new", createdAt: "2026-11-03T10:00:00Z" },
    ]));
    await mount();
    await waitFor(() => expect(hooks.apply).toHaveBeenCalledTimes(1));
    expect(hooks.apply.mock.calls[0][0].orderId).toBe("debtor-old");
    // One write per pass: even with two debts, the first application is the
    // only write; the listener round-trip replans the remainder.
    await act(async () => { await Promise.resolve(); });
    expect(hooks.apply).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed application through the sync error with an idempotent retry", async () => {
    hooks.apply.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await waitFor(() => expect(hooks.apply).toHaveBeenCalledTimes(1));
    // persistInBackground surfaced the failure (retry available), and the
    // state did not change, so no second write was attempted.
    expect(hooks.apply).toHaveBeenCalledTimes(1);
    await act(async () => {
      await context.syncError?.retry?.();
    });
    expect(hooks.apply).toHaveBeenCalledTimes(2);
    const [first, retryCall] = hooks.apply.mock.calls.map((call) => call[0]);
    // Same planned compensation; the tx re-validates fresh docs, so money
    // idempotency holds even if a re-plan minted a new intent id.
    expect(retryCall.orderId).toBe(first.orderId);
    expect(retryCall.entry.fromOrderId).toBe(first.entry.fromOrderId);
    expect(retryCall.entry.amountCents).toBe(first.entry.amountCents);
  });

  it("restitutes the consumed credit when an order is validly cancelled", async () => {
    // Steady state: compensation already applied.
    hooks.load.mockResolvedValue(stateWith([
      { ...creditor(), creditConsumedCents: 1500 },
      { ...debtor(), creditAppliedCents: 1500 },
    ]));
    await mount();
    await act(async () => { await Promise.resolve(); });
    expect(hooks.apply).not.toHaveBeenCalled(); // plan empty
    hooks.saveOrderTx.mockResolvedValue({
      order: { ...debtor(), orderStatus: "cancelled", creditAppliedCents: 1500 },
      stock: [],
    });
    await act(async () => {
      await context.upsertOrder({ ...debtor(), orderStatus: "cancelled" } as Order);
    });
    expect(hooks.release).toHaveBeenCalledWith({
      orderId: "debtor", storeId: "s1", by: "operator-a",
    });
  });
});
