// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "../../design-system";
import { HomeScreen } from "./HomeScreen";
import { fixtureState } from "../../lib/testFixtures";
import { orderReference } from "../../lib/orders";
import { StaleOrderError } from "../../app/firebase/firestoreData";
import { resetReturnOriginForTests, takeReturnOrigin } from "../../lib/returnOrigin";
import type { AppState, Order, Product } from "../../types";

// Direct useStore mock: synchronous mount, no hydration race (#111 removed
// browser-storage state; the cloud mount is async and these are view tests).
const mocks = vi.hoisted(() => ({ state: null as null | AppState, stateStatus: "ready", upsertOrder: vi.fn(), loadOrderPayments: vi.fn(async () => {}), registerOrderPayment: vi.fn() }));
// #539: the Home card navigates to the exact order — assert the destination.
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("../../lib/router", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/router")>(),
  navigate: navigateMock,
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    state: mocks.state,
    activeStore: mocks.state?.stores.find((st) => st.id === mocks.state!.activeStoreId) ?? null,
    stateStatus: mocks.stateStatus,
    upsertOrder: mocks.upsertOrder,
    payments: [],
    loadOrderPayments: mocks.loadOrderPayments,
    registerOrderPayment: mocks.registerOrderPayment,
    // #279: the from-activation position card (idle → nothing loads in unit tests).
    financial: { status: "idle" as const, cardPayments: [] },
    loadFinancialPosition: async () => {},
    registerCardPayment: async () => {},
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

/** Minimal color variant for #365 fixtures (required timestamps included). */
function variant(id: string, color: string, quantityOnHand?: number) {
  return { id, color, quantityOnHand, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" };
}

/** Alert badge texts in DOM order (each restock badge joins name · label).
 * #539: matches only Badge spans (rounded-full) — order cards also join text
 * with « · » and must not pollute the alert list. */
function restockBadges(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("span.rounded-full"))
    .map((s) => s.textContent ?? "")
    .filter((t) => t.includes(" · "));
}

beforeEach(() => {
  localStorage.clear();
  mocks.upsertOrder.mockReset().mockImplementation(async (order: Order) => order);
});

describe("HomeScreen alertas de existencias (FER-09)", () => {
  it("#132: aviso privado cuando el mes pasado tiene ranking sin confirmar; desaparece al confirmar", () => {
    const NOW2 = "2026-11-14T10:00:00.000Z";
    const order = {
      id: "o1", storeId: OLIVIA, customerId: "c_emp",
      items: [{ lineId: "L0", productId: "p1", productName: "Pieza", quantity: 2, unitPrice: 500, subtotal: 1000 }],
      deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
      deliveries: [{ id: "d1", orderId: "o1", storeId: OLIVIA, deliveredAt: "2026-10-05", recordedAt: NOW2, by: "u1", lines: [{ productId: "p1", quantity: 2 }] }],
      paymentsReceivedCents: 100000, createdAt: NOW2, updatedAt: NOW2,
    } as never as Order;
    const entrepreneur = { id: "c_emp", storeId: OLIVIA, name: "Ana", segment: "entrepreneur", createdAt: NOW2, updatedAt: NOW2 } as never;

    const unconfirmed = fixtureState();
    unconfirmed.orders = [order];
    unconfirmed.customers = [entrepreneur];
    unconfirmed.rankingConfirmations = [];
    const Wrapper1 = withState(unconfirmed);
    const view = render(<Wrapper1><HomeScreen /></Wrapper1>);
    expect(screen.getByText(/Top emprendedoras listo para tu revisión/)).toBeTruthy();
    view.unmount();

    const confirmed = fixtureState();
    confirmed.orders = [order];
    confirmed.customers = [entrepreneur];
    confirmed.rankingConfirmations = [{
      id: `${OLIVIA}__2026-10`, storeId: OLIVIA, year: 2026, month: 10, revision: 1,
      entries: [], tieResolutions: [], confirmedBy: "u1", confirmedAt: NOW2,
    } as never];
    const Wrapper2 = withState(confirmed);
    render(<Wrapper2><HomeScreen /></Wrapper2>);
    expect(screen.queryByText(/Top emprendedoras listo para tu revisión/)).toBeNull();
  });

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

  it("#365 muestra diseños por color agotados y con agregado negativo — mismo agregado que la ficha", () => {
    const state = fixtureState();
    state.products = [
      // "Reloj Austin" after #124: shelf moved to colors, design field erased.
      product({
        id: "austin",
        name: "Reloj Austin",
        quantityOnHand: undefined,
        variants: [
          variant("v1", "Cafe", 0),
          variant("v2", "Ivory", 0),
          variant("v3", "Black", 0),
        ],
      }),
      product({
        id: "arracadas",
        name: "Arracadas Viento",
        quantityOnHand: undefined,
        variants: [
          variant("v1", "Dorado", -5),
          variant("v2", "Plata", 3),
        ],
      }),
      // Sin rastreo (ningún color con existencia) y diseño sano: fuera.
      product({
        id: "untracked",
        name: "Collar Nube",
        quantityOnHand: undefined,
        variants: [
          variant("v1", "Perla", undefined),
        ],
      }),
      product({
        id: "healthy",
        name: "Aretes Sol",
        quantityOnHand: undefined,
        variants: [
          variant("v1", "Dorado", 12),
        ],
      }),
    ];
    const Wrapper = withState(state);
    const { container } = render(
      <Wrapper>
        <HomeScreen />
      </Wrapper>
    );

    expect(screen.getByText("⚠️ Por surtir")).toBeTruthy();
    // Worst first by aggregate: −2 (Arracadas) antes que 0 (Austin).
    expect(restockBadges(container)).toEqual([
      "Arracadas Viento · Faltan 2",
      "Reloj Austin · Agotado",
    ]);
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
    // #279 r4: evidence rule everywhere — the sheet opens with the net
    // prefilled; a bare deposit (upsertOrder) never happens from Inicio.
    expect(await screen.findByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
    const amount = await screen.findByLabelText(/Monto/i);
    expect((amount as HTMLInputElement).value).toBe("500");
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
    expect(screen.queryByText("Pedido cobrado")).toBeNull();
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
    // #279 r4: NET prefilled ($500, never the gross $1,000) via evidence.
    expect(await screen.findByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
    const amount = await screen.findByLabelText(/Monto/i);
    expect((amount as HTMLInputElement).value).toBe("500");
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
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
  // #279 r4: the sheet opens directly with the net prefilled; concurrent
  // cobros reconcile inside registerOrderPaymentTx (#218), never by a
  // deposit write that ignores them.
  expect(await screen.findByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
  expect(screen.queryByText("Pedido cobrado")).toBeNull();
  expect(mocks.upsertOrder).not.toHaveBeenCalled();
});

describe("#406 r2 — ventana de carga sin $0 falso", () => {
  beforeEach(() => {
    // This suite asserts absence across renders — start each from a clean DOM.
    cleanup();
    mocks.stateStatus = "ready";
  });

  it("mientras los pedidos cargan, las cifras de dinero muestran «—», nunca $0", () => {
    mocks.stateStatus = "loading";
    const state = fixtureState();
    const Wrapper = withState(state);
    render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByText("Falta cobrar")).toBeTruthy();
    expect(screen.getByText("Ganancia esperada")).toBeTruthy();
    // El valor en carga es «—»: jamás un $0 con apariencia de definitivo.
    expect(screen.getAllByLabelText("Cargando").length).toBe(2);
    expect(screen.queryByText("$0")).toBeNull();
  });

  it("con el estado listo, las cifras reales aparecen (los «—» desaparecen)", () => {
    mocks.stateStatus = "ready";
    const state = fixtureState();
    const Wrapper = withState(state);
    const { container } = render(<Wrapper><HomeScreen /></Wrapper>);
    expect(screen.getByText("Falta cobrar")).toBeTruthy();
    const cargando = container.querySelectorAll('[aria-label="Cargando"]');
    expect(cargando.length).toBe(0);
  });
});

describe("#455 r3 — el cierre visible desde Inicio", () => {
  it("la cabecera de Inicio ofrece «Cierre mensual» y navega a /productos/cierre", () => {
    render(<ToastProvider><HomeScreen /></ToastProvider>);
    expect(screen.getByRole("button", { name: "Cierre mensual" })).toBeTruthy();
  });
});

describe("#539 Inicio → pedido exacto y «Preparar» con confirmación", () => {
  function confirmedOrder(): Order {
    return {
      ...(fixtureState().orders[0] as Order),
      id: "ord-539",
      orderStatus: "confirmed",
      installmentsReservedAt: undefined,
      items: [{ lineId: "l1", productName: "Aro luna", quantity: 2, unitPrice: 500, subtotal: 1000 }],
    };
  }

  function mountWith(order: Order) {
    const state = fixtureState();
    state.orders = [order];
    mocks.state = state;
    return render(<ToastProvider><HomeScreen /></ToastProvider>);
  }

  /** La misma pantalla con otro estado: como cuando la sincronización trae el pedido cambiado. */
  function syncWith(view: ReturnType<typeof mountWith>, order: Order) {
    const state = fixtureState();
    state.orders = [order];
    mocks.state = state;
    view.rerender(<ToastProvider><HomeScreen /></ToastProvider>);
  }

  beforeEach(() => {
    navigateMock.mockClear();
    resetReturnOriginForTests();
  });
  // The confirm action arms on a timer (the dialog's entry motion): let it pass.
  const confirmButton = () => screen.getByRole("button", { name: "Preparar pedido" });
  const settle = () => waitFor(() => expect(confirmButton()).toBeEnabled());

  it("tocar la tarjeta abre el pedido EXACTO sin cambiar su estado", async () => {
    const order = confirmedOrder();
    mountWith(order);
    const openCard = await screen.findByRole("button", { name: /Aro luna/ });
    fireEvent.click(openCard);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/pedidos/ord-539");
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });

  it("la tarjeta se identifica con su folio #XXXXXX (convención de la app)", async () => {
    mountWith(confirmedOrder());
    const openCard = await screen.findByRole("button", { name: /Aro luna/ });
    expect(openCard.textContent).toContain(`#${orderReference("ord-539")}`);
  });

  it("la tarjeta dice cuántas piezas lleva cada producto, como la lista de Pedidos (no hay que abrirlo)", async () => {
    mountWith(confirmedOrder()); // 2 × Aro luna
    const openCard = await screen.findByRole("button", { name: /Aro luna/ });
    expect(openCard.textContent).toContain("2 × Aro luna");
  });

  it("la mitad inferior de la tarjeta (Total/Saldo) también abre el pedido, sin cambiar su estado", async () => {
    const order = confirmedOrder();
    mountWith(order);
    await screen.findByRole("button", { name: /Aro luna/ });
    // QA minor 2: the money half looked tappable and did nothing.
    fireEvent.click(screen.getByText("Saldo"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/pedidos/ord-539");
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abrir desde Inicio registra el retorno: el editor vuelve a Inicio, no a la lista", async () => {
    mountWith(confirmedOrder());
    fireEvent.click(await screen.findByRole("button", { name: /Aro luna/ }));
    expect(takeReturnOrigin("ord-539")).toBe("/");
  });

  it("las acciones de la tarjeta no abren el pedido: «Preparar» solo confirma, «Cobrar» abre Cobros", async () => {
    const order = confirmedOrder();
    mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(navigateMock).not.toHaveBeenCalled();

    // A delivered order with a pending balance offers «Cobrar» instead of a verb.
    cleanup();
    const delivered = { ...confirmedOrder(), id: "ord-539-cobrar", orderStatus: "delivered" } as Order;
    mountWith(delivered);
    fireEvent.click(await screen.findByRole("button", { name: "Cobrar" }));
    await waitFor(() => expect(mocks.loadOrderPayments).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("«Preparar» abre confirmación que identifica el pedido y el paso Confirmado → Preparando", async () => {
    const order = confirmedOrder();
    mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Confirmado/);
    expect(dialog.textContent).toMatch(/Preparando/);
    expect(within(dialog).getByText(/Aro luna|ord-539/)).toBeTruthy();
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });

  it("Cancelar deja todo intacto", async () => {
    const order = confirmedOrder();
    mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
    expect((mocks.state!.orders[0] as Order).orderStatus).toBe("confirmed");
  });

  it("Confirmar cambia ÚNICAMENTE ese pedido a Preparando", async () => {
    const order = confirmedOrder();
    mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    await settle();
    fireEvent.click(confirmButton());
    expect(mocks.upsertOrder).toHaveBeenCalledOnce();
    const saved = mocks.upsertOrder.mock.calls[0][0] as Order;
    expect(saved.id).toBe("ord-539");
    expect(saved.orderStatus).toBe("preparing");
  });

  it("si el pedido cambió mientras la confirmación estaba abierta, muestra su estado actualizado y NO avanza", async () => {
    const order = confirmedOrder();
    const view = mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    // otra sesión lo prepara mientras el diálogo está abierto: la sincronización lo trae
    syncWith(view, { ...order, orderStatus: "ready" });
    await settle();
    fireEvent.click(confirmButton());
    expect(screen.getByText(/ya no está Confirmado: ahora está Listo\./)).toBeTruthy();
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });

  it("un doble toque sobre «Preparar» no confirma: mientras el diálogo entra, «Preparar pedido» está deshabilitado", async () => {
    mountWith(confirmedOrder());
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    // El segundo toque de un doble toque cae donde acaba de aparecer «Preparar pedido».
    expect(confirmButton()).toBeDisabled(); // a la vista: aún no contesta
    fireEvent.click(confirmButton());
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy(); // sigue abierto: nada se confirma sin leerlo
    await settle();
    fireEvent.click(confirmButton());
    expect(mocks.upsertOrder).toHaveBeenCalledOnce();
  });

  it("«Marcar listo» conserva su avance directo (sin confirmación)", async () => {
    const order = { ...confirmedOrder(), orderStatus: "preparing" as const };
    mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar listo" }));
    expect(mocks.upsertOrder).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Misión UX #539: sin aviso no se sabía si había guardado; la lista sí avisaba.
    expect(await screen.findByText(`Pedido #${orderReference("ord-539")} avanzado a «Listo»`)).toBeTruthy();
  });

  it("un avance directo rechazado porque el pedido cambió en otro dispositivo dice ese motivo", async () => {
    mountWith({ ...confirmedOrder(), orderStatus: "preparing" });
    mocks.upsertOrder.mockRejectedValueOnce(new StaleOrderError());
    fireEvent.click(await screen.findByRole("button", { name: "Marcar listo" }));
    expect(await screen.findByText("El pedido cambió en otro dispositivo. Vuelve a entrar para ver la versión reciente.")).toBeTruthy();
  });

  it("si el pedido de la confirmación sale de la tienda mientras el diálogo está abierto, se cierra y no reaparece al volver", async () => {
    const order = confirmedOrder();
    const view = mountWith(order);
    fireEvent.click(await screen.findByRole("button", { name: "Preparar" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    // deja el contexto de la tienda (otro la movió) y después regresa
    syncWith(view, { ...order, storeId: "otra-tienda" });
    expect(screen.queryByRole("dialog")).toBeNull();
    syncWith(view, order);
    await screen.findByRole("button", { name: "Preparar" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.upsertOrder).not.toHaveBeenCalled();
  });
});
