// @vitest-environment jsdom
// #265 — the provider reconciles received stock EXCLUSIVELY from the
// transaction's returned updates: what the screen shows right after receiving
// is exactly what Firestore persisted (exact latest_purchase cost).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { useStore, StoreProvider } from "./StoreProvider";
import { Button } from "../design-system";
import { fixtureState } from "../lib/testFixtures";
import type { ProductStockUpdate } from "../lib/inventory";
import type { Purchase } from "../types";

const mocks = vi.hoisted(() => ({
  loadCloudState: vi.fn(),
  receivePurchaseTx: vi.fn(),
}));

vi.mock("./firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: { uid: "u1", email: "a@x.com", role: "member" as const }, authReady: true, enabled: true, error: null, signOut: async () => {} }),
}));
vi.mock("./firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./firebase/firestoreData")>();
  return {
    ...actual,
    loadCloudState: mocks.loadCloudState,
    subscribeCloudState: vi.fn(() => () => {}),
    receivePurchaseTx: mocks.receivePurchaseTx,
  };
});

function Probe({ onReady }: { onReady: () => void }) {
  const { receivePurchase, state } = useStore();
  onReady();
  return (
    <>
      <div data-testid="cost">{state.products[0]?.cost ?? "—"}</div>
      <div data-testid="qty">{state.products[0]?.quantityOnHand ?? "—"}</div>
      <Button onClick={() => void receivePurchase(state.purchases[0] as unknown as Purchase)}>Recibir</Button>
    </>
  );
}

describe("receivePurchase reconcilia con el retorno de la transacción (#265)", () => {
  beforeEach(() => {
    const state = fixtureState();
    state.products[0] = { ...state.products[0], cost: 50, quantityOnHand: 10 };
    state.purchases = [
      {
        id: "pur_1",
        storeId: "store_olivia",
        supplierId: "sup_1",
        lines: [{ lineId: "l1", productId: state.products[0].id, quantity: 3, unitCost: 100 }],
        costingMethod: "latest_purchase",
        status: "confirmed",
        createdAt: "2026-11-08T00:00:00.000Z",
        updatedAt: "2026-11-08T00:00:00.000Z",
      } as unknown as Purchase,
    ];
    mocks.loadCloudState.mockReset().mockResolvedValue(state);
    mocks.receivePurchaseTx.mockReset().mockResolvedValue({
      stockUpdates: new Map<string, ProductStockUpdate>([
        [state.products[0].id, { quantityOnHand: 13, cost: 100.33 }],
      ]),
    });
  });

  it("el costo en estado local tras recibir es el EXACTO que la transacción aplicó", async () => {
    const view = render(
      <StoreProvider>
        <Probe onReady={() => {}} />
      </StoreProvider>
    );
    await waitFor(() => expect(view.getByTestId("cost").textContent).toBe("50"));
    fireEventProbeClick(view.container);
    await waitFor(() => expect(view.getByTestId("cost").textContent).toBe("100.33"));
    expect(view.getByTestId("qty").textContent).toBe("13");
    expect(mocks.receivePurchaseTx).toHaveBeenCalledWith("pur_1");
  });
});

function fireEventProbeClick(container: HTMLElement) {
  fireEvent.click(container.querySelector("button")!);
}
