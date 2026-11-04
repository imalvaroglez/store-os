import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../design-system";
import { HomeScreen } from "./HomeScreen";
import { fixtureState } from "../../lib/testFixtures";
import type { AppState, Order, Product } from "../../types";

// Direct useStore mock: synchronous mount, no hydration race (#111 removed
// browser-storage state; the cloud mount is async and these are view tests).
const mocks = vi.hoisted(() => ({ state: null as null | AppState, upsertOrder: vi.fn(), loadOrderPayments: vi.fn(async () => {}), registerOrderPayment: vi.fn() }));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    state: mocks.state,
    activeStore: mocks.state?.stores.find((st) => st.id === mocks.state!.activeStoreId) ?? null,
    upsertOrder: mocks.upsertOrder,
    payments: [],
    loadOrderPayments: mocks.loadOrderPayments,
    registerOrderPayment: mocks.registerOrderPayment,
  }),
}));

function withState(state: AppState) {
  mocks.state = state;
  return ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
}

const OLIVIA = "store_olivia";
const SANTI = "store_santi";

function product(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    storeId: OLIVIA,
    category: "jewelry",
    isPublic: true,
    status: "published",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as Product;
}

/** Alert badge texts in DOM order (each restock badge joins name · label). */
function restockBadges(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("span"))
    .map((s) => s.textContent ?? "")
    .filter((t) => t.includes(" · "));
}

beforeEach(() => {
  localStorage.clear();
});

describe("HomeScreen alertas de existencias (FER-09)", () => {
  it("muestra Agotado, Faltan y Quedan N — peor primero — y omite existencias sanas", () => {
    const state = fixtureState();
    state.products = [
      product({ id: "healthy", name: "Collar sano", quantityOnHand: 10 }),
      // No saved threshold: the conservative default (3) applies.
      product({ id: "low", name: "Aretes Luna", quantityOnHand: 2 }),
      product({ id: "out", name: "Anillo Blossom", quantityOnHand: 0 }),
      product({ id: "shortage", name: "Escarbadientes", quantityOnHand: -2 }),
    ];
    const Wrapper = withState(state);
    const { container } = render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    expect(screen.getByText("⚠️ Por surtir")).toBeTruthy();
    expect(restockBadges(container)).toEqual([
      "Escarbadientes · Faltan 2",
      "Anillo Blossom · Agotado",
      "Aretes Luna · Quedan 2",
    ]);
    // Healthy stock never alerts.
    expect(screen.queryByText(/Collar sano/)).toBeNull();
  });

  it("no muestra alertas en tiendas bajo pedido (sin seguimiento de stock)", () => {
    const state = fixtureState();
    state.activeStoreId = SANTI;
    state.products = [
      product({ id: "ondemand", storeId: SANTI, name: "Perfume a pedido", quantityOnHand: undefined }),
    ];
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    expect(screen.queryByText("⚠️ Por surtir")).toBeNull();
  });

  it("Cobrar on an order with payment records OPENS the sheet — no fake success (Codex P1)", async () => {
    const state = fixtureState();
    const withRecords: Order = {
      ...state.orders[0],
      orderStatus: "delivered",
      paymentsReceivedCents: 40000,
      inheritedDepositMaterialized: true,
      items: [{ lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
    };
    state.orders = [withRecords];
    const Wrapper = withState(state);
    render(<Wrapper><HomeScreen /></Wrapper>);

    await screen.findByText("Cobrar");
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    // The cobros sheet opens; NO order write, NO success toast.
    expect(await screen.findByRole("dialog", { name: "Cobros del pedido" })).toBeTruthy();
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });

  it("Cobrar on a legacy deposit-only order keeps the one-tap collect", async () => {
    const state = fixtureState();
    const legacy: Order = {
      ...state.orders[0],
      deposit: 0,
      items: [{ lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: 500, subtotal: 500 }],
    };
    state.orders = [legacy];
    const Wrapper = withState(state);
    render(<Wrapper><HomeScreen /></Wrapper>);

    await screen.findByText("Cobrar");
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    await waitFor(() => expect(mocks.upsertOrder).toHaveBeenCalledTimes(1));
    expect(mocks.upsertOrder.mock.calls[0][0].deposit).toBe(500);
  });
});
