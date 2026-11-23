// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./StoreProvider";
import type { AppState, Store, Product, Order } from "../types";

const mocks = vi.hoisted(() => ({
  user: { uid: "fer375", email: "fer375@test.mx", role: "member" as const },
  loadCloudState: vi.fn(),
  subscribeCloudState: vi.fn(() => () => {}),
  deleteEntity: vi.fn(async () => {}),
  unprojectPublicForStore: vi.fn(async () => {}),
  retainStoreEvidence: vi.fn(async () => {}),
  deleteProductImage: vi.fn(async () => {}),
  deletePurchasePdf: vi.fn(async () => {}),
}));

vi.mock("./firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: false, error: null, signOut: async () => {} }),
}));
vi.mock("./firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/firestoreData")>();
  return {
    ...actual,
    loadCloudState: mocks.loadCloudState,
    subscribeCloudState: mocks.subscribeCloudState,
    deleteEntity: mocks.deleteEntity,
    unprojectPublicForStore: mocks.unprojectPublicForStore,
    retainStoreEvidence: mocks.retainStoreEvidence,
  };
});
vi.mock("./firebase/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/storage")>();
  return {
    ...actual,
    deleteProductImage: mocks.deleteProductImage,
    deletePurchasePdf: mocks.deletePurchasePdf,
  };
});

const now = "2026-01-01T00:00:00.000Z";
const store: Store = { id: "s1", name: "S", slug: "s", type: "inventory_tiered", ownerUid: "fer375", memberUids: ["fer375"], createdAt: now, updatedAt: now } as Store;
const product: Product = { id: "p1", storeId: "s1", name: "P", sku: "P1", category: "other", status: "published", createdAt: now, updatedAt: now } as Product;
const paidOrder: Order = { id: "o-paid", storeId: "s1", customerId: "c1", items: [], deposit: 0, paymentsReceivedCents: 50000, orderStatus: "delivered", revision: 1, createdAt: now, updatedAt: now } as unknown as Order;
const freeOrder: Order = { id: "o-free", storeId: "s1", customerId: "c1", items: [], deposit: 0, orderStatus: "asked", revision: 1, createdAt: now, updatedAt: now } as unknown as Order;
// Net-zero correction: the KEY exists with value 0 — the rules keep it, so the
// client must not attempt its delete (chain poison otherwise).
const netZeroOrder: Order = { id: "o-netzero", storeId: "s1", customerId: "c1", items: [], deposit: 0, paymentsReceivedCents: 0, orderStatus: "delivered", revision: 1, createdAt: now, updatedAt: now } as unknown as Order;
const receivedPurchase = { id: "pu-recv", storeId: "s1", status: "received" as const, date: "2026-11-01", lines: [], subtotal: 0, createdAt: now, updatedAt: now } as never;
const draftPurchase = { id: "pu-draft", storeId: "s1", status: "draft" as const, date: "2026-11-01", lines: [], subtotal: 0, createdAt: now, updatedAt: now } as never;

function stateWith(): AppState {
  return { stores: [store], products: [product], customers: [], orders: [paidOrder, freeOrder, netZeroOrder], suppliers: [], purchases: [receivedPurchase, draftPurchase], categories: [], activeStoreId: "s1" } as unknown as AppState;
}

describe("#375 deleteStore sequencing", () => {
  afterEach(() => vi.clearAllMocks());

  it("cleans up FIRST and seals LAST — the seal never races a membership-gated write", async () => {
    mocks.loadCloudState.mockResolvedValue(stateWith());
    const calls: string[] = [];
    mocks.deleteEntity.mockImplementation((...args: unknown[]) => {
      const [, col, id] = args as [unknown, string, string];
      calls.push(`delete:${col}:${id}`);
      return Promise.resolve();
    });
    mocks.unprojectPublicForStore.mockImplementation(async () => { calls.push("unproject"); });
    mocks.retainStoreEvidence.mockImplementation(async () => { calls.push("seal"); });
    const wrapper = ({ children }: { children: React.ReactNode }) => <StoreProvider>{children}</StoreProvider>;
    const { result } = renderHook(() => useStore(), { wrapper });
    await waitFor(() => expect(result.current.state.products).toHaveLength(1));
    act(() => { result.current.deleteStore("s1"); });
    await waitFor(() => expect(calls).toContain("seal"));
    expect(calls.indexOf("seal")).toBe(calls.length - 1);
    expect(calls).toContain("delete:stores:s1");
    expect(calls).toContain("delete:products:p1");
    expect(calls).toContain("delete:orders:o-free");
    expect(calls).not.toContain("delete:orders:o-paid"); // money evidence retained
    expect(calls).not.toContain("delete:orders:o-netzero"); // key-presence = retained by rules
    expect(calls).not.toContain("delete:purchases:pu-recv"); // received purchase: rules deny forever
    expect(calls).toContain("delete:purchases:pu-draft"); // deletable purchase goes
    expect(calls.indexOf("unproject")).toBeLessThan(calls.indexOf("seal"));
    for (const c of calls) if (c.startsWith("delete:")) expect(calls.indexOf(c)).toBeLessThan(calls.indexOf("seal"));
  });
});
