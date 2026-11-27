// @vitest-environment jsdom
// #552 — the REAL provider wiring must honor an EXPLICIT expectedRevision
// (null = "the editor believes it is creating"): ?? swallowed that null and
// substituted the shell's revision, turning a recoverable already-saved
// create into a misleading cross-device conflict toast.
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Order } from "../types";
import type { AppUser } from "./firebase/auth";

const hooks = vi.hoisted(() => ({
  user: null as AppUser | null,
  save: vi.fn(),
  load: vi.fn(),
  subscribe: vi.fn(),
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
  saveOrderWithStockTx: hooks.save,
  saveEntity: vi.fn().mockResolvedValue(undefined), projectPublicForStore: vi.fn().mockResolvedValue(undefined),
  ensureStoreFinancials: vi.fn().mockResolvedValue({ storeId: "rev-store", activatedAt: "2026-11-01T00:00:00.000Z" }),
}));
import { StoreProvider, useStore } from "./StoreProvider";

const saved: Order = {
  id: "order_wired", storeId: "rev-store", customerId: "c1", customerName: "Lucía",
  items: [{ productName: "Reloj B", quantity: 2, unitPrice: 120, subtotal: 240 }],
  deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", revision: 1, lastMutationId: "ui-first-lost",
  createdAt: "2026-11-27", updatedAt: "2026-11-27",
};
const state = (): AppState => ({
  stores: [{ id: "rev-store", name: "Tienda", slug: "rev-store", type: "on_demand", createdAt: "", updatedAt: "" }],
  activeStoreId: "rev-store", products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [saved], expenses: [],
  points: [], pointEntries: [], pointOperations: [], pointExhibitors: [],
});
let context: ReturnType<typeof useStore>;
function Probe() {
  context = useStore();
  return <span data-testid="ok">ok</span>;
}

describe("#552 — upsertOrder respeta el expectedRevision explícito del llamador", () => {
  beforeEach(() => {
    hooks.user = { uid: "operator-a", email: "op@test", role: "member" } as never;
    hooks.load.mockReset().mockResolvedValue(state());
    hooks.subscribe.mockReset().mockReturnValue(() => {});
    hooks.save.mockReset().mockResolvedValue({ order: saved, stock: [] });
  });

  it("un create explícito (null) llega a la transacción como null aunque el pedido ya esté en memoria", async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(context.state.orders).toHaveLength(1));
    // El formulario nuevo envía su shell sin revisión y expectedRevision null.
    const shell = { ...saved, revision: undefined, lastMutationId: undefined };
    await context.upsertOrder(shell, { expectedRevision: null, mutationId: "mut-editor" });
    expect(hooks.save).toHaveBeenCalledTimes(1);
    const expectedRevision = hooks.save.mock.calls[0][2];
    expect(expectedRevision).toBeNull();
  });

  it("sin options se conserva el respaldo histórico: la revisión del propio pedido", async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(context.state.orders).toHaveLength(1));
    await context.upsertOrder(saved);
    expect(hooks.save).toHaveBeenCalledTimes(1);
    expect(hooks.save.mock.calls[0][2]).toBe(1);
  });
});
