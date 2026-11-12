import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
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
  mocks.upsertOrder.mockReset().mockImplementation(async (order: Order) => order);
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

  it("#337 cuenta PRODUCTOS con alerta y declara la unidad — 40 productos aunque falten cientos de piezas", () => {
    const state = fixtureState();
    // 40 alerted products whose pieces-to-threshold add up to 280+ — the card
    // must count products, never sum quantities as if they were products.
    state.products = Array.from({ length: 40 }, (_, i) =>
      product({
        id: `p${i}`,
        name: `Pieza ${i}`,
        quantityOnHand: i < 20 ? 0 : 3,
        lowStockAt: i < 20 ? 7 : 15,
      })
    );
    const piecesToThreshold = state.products.reduce(
      (sum, p) => sum + ((p.lowStockAt ?? 3) - (p.quantityOnHand ?? 0)),
      0
    );
    expect(piecesToThreshold).toBeGreaterThanOrEqual(280); // fixture guard: the trap is real
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    expect(screen.getByText("40 productos")).toBeTruthy();
    expect(screen.queryByText(/^40$/)).toBeNull(); // nunca un número sin unidad
    expect(screen.queryByText(String(piecesToThreshold))).toBeNull(); // jamás la suma de piezas
  });

  it("#337 con 280 productos en alerta dice 280 productos; con uno, 1 producto", () => {
    const state = fixtureState();
    state.products = Array.from({ length: 280 }, (_, i) =>
      product({ id: `p${i}`, name: `Pieza ${i}`, quantityOnHand: 0 })
    );
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );
    expect(screen.getByText("280 productos")).toBeTruthy();

    const single = fixtureState();
    single.products = [product({ id: "only", name: "Único agotado", quantityOnHand: 0 })];
    const WrapperOne = withState(single);
    cleanup();
    render(
      <WrapperOne>
        <HomeScreen />
      </WrapperOne>
    );
    expect(screen.getByText("1 producto")).toBeTruthy();
  });

  it("#337 un producto sin inventario rastreable no se cuenta aunque la tienda siga existencias", () => {
    const state = fixtureState();
    state.products = [
      product({ id: "tracked", name: "Rastreado", quantityOnHand: 0 }),
      product({ id: "untracked", name: "Sin rastreo", quantityOnHand: undefined }),
    ];
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    expect(screen.getByText("1 producto")).toBeTruthy();
    expect(screen.queryByText(/Sin rastreo/)).toBeNull();
  });

  it("#337 el total es de la tienda activa: cambiar de tienda cambia el conjunto, sin arrastrar conteos", () => {
    const state = fixtureState();
    state.products = [
      product({ id: "olivia1", storeId: OLIVIA, name: "De Olivia", quantityOnHand: 0 }),
      product({ id: "olivia2", storeId: OLIVIA, name: "De Olivia 2", quantityOnHand: 0 }),
      product({ id: "santi1", storeId: SANTI, name: "De Santi", quantityOnHand: 0 }),
    ];
    // fixtureState's SANTI store is on-demand: switch its type so it tracks
    // stock and its product can legitimately alert.
    state.stores = state.stores.map((st) => (st.id === SANTI ? { ...st, type: "inventory_tiered" } : st));
    const Wrapper = withState(state);
    const view = render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );
    expect(screen.getByText("2 productos")).toBeTruthy();

    // The operator switches store: same synced products, new active store.
    mocks.state = { ...state, activeStoreId: SANTI };
    view.rerender(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );
    expect(screen.getByText("1 producto")).toBeTruthy();
    expect(screen.queryByText(/De Olivia/)).toBeNull();
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

  it("the sheet shows the CANONICAL order after an abono updates it (Codex P1 regression)", async () => {
    const state = fixtureState();
    const order: Order = {
      ...state.orders[0],
      orderStatus: "delivered",
      paymentsReceivedCents: 40000,
      inheritedDepositMaterialized: true,
      items: [{ lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
    };
    state.orders = [order];
    const Wrapper = withState(state);
    const view = render(<Wrapper><HomeScreen /></Wrapper>);

    await screen.findByText("Cobrar");
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    const sheet = await screen.findByRole("dialog", { name: "Cobros del pedido" });
    expect(within(sheet).getByText("$400.00")).toBeTruthy(); // Recibido inicial

    // The canonical order updates (an abono landed elsewhere / sync arrived).
    mocks.state = { ...state, orders: [{ ...order, paymentsReceivedCents: 70000 }] };
    view.rerender(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByText("$700.00")).toBeTruthy(); // Recibido canónico
    expect(screen.getByText("$300.00")).toBeTruthy(); // Saldo recalculado

    // If the order leaves the current store context, the sheet closes.
    mocks.state = { ...state, orders: [] };
    view.rerender(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.queryByRole("dialog", { name: "Cobros del pedido" })).toBeNull();
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
    expect(await screen.findByText("Pedido cobrado")).toBeInTheDocument();
  });

  it("#362 Cobrar collects the NET pending — saldo a favor applied from a sister order is never re-charged as cash", async () => {
    const state = fixtureState();
    // Total $1,000, no payment records (legacy path), $500 of credit applied
    // from a sister order: the clienta owes $500 in real money.
    const legacy: Order = {
      ...state.orders[0],
      deposit: 0,
      creditAppliedCents: 50000,
      creditLedger: [{ id: "cl1", kind: "application", fromOrderId: "o_sister", amountCents: 50000, at: "2026-11-10T10:00:00.000Z", by: "u1" }],
      items: [{ lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
    };
    state.orders = [legacy];
    const Wrapper = withState(state);
    render(<Wrapper><HomeScreen /></Wrapper>);

    await screen.findByText("Cobrar");
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    await waitFor(() => expect(mocks.upsertOrder).toHaveBeenCalledTimes(1));
    // NET ($500), never the gross historical total ($1,000).
    expect(mocks.upsertOrder.mock.calls[0][0].deposit).toBe(500);
    expect(await screen.findByText("Pedido cobrado")).toBeInTheDocument();
  });
});


it("opens Cobros with honest feedback when a stale home collection is pinned (#218)", async () => {
  const state = fixtureState();
  const legacy: Order = { ...state.orders[0], deposit: 0, orderStatus: "delivered", items: [{ productName: "Pieza", quantity: 1, unitPrice: 720, subtotal: 720 }] };
  state.orders = [legacy];
  mocks.upsertOrder.mockResolvedValue({ ...legacy, deposit: 0, paymentsReceivedCents: 59000 });
  const Wrapper = withState(state);
  render(<Wrapper><HomeScreen /></Wrapper>);
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
  expect(await screen.findByText("Este pedido ya tiene cobros registrados. Regístralos en Cobros.")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
  expect(screen.queryByText("Pedido cobrado")).toBeNull();
});
