// @vitest-environment jsdom
// #524 — Ventas → Puntos de venta, first UI cut: the list with live
// pieces/valuation, point creation with pilot defaults, and the
// «Usar como surtido inicial» preview + trusted conversion call.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PointsOfSaleScreen } from "./PointsOfSaleScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Order, PointEntry, Product, Store } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  savePoint: vi.fn(),
  convertOrderToFirstSurtido: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      savePoint: mocks.savePoint,
      convertOrderToFirstSurtido: mocks.convertOrderToFirstSurtido,
    }),
  };
});

const NOW = "2026-11-21T12:00:00.000Z";

function tieredStore(): Store {
  const store = { ...mocks.state!.stores[0] } as Store;
  store.type = "inventory_tiered";
  store.priceTiers = [
    { id: "t_retail", label: "Regular", order: 1 },
    { id: "t_girly", label: "Girly", order: 2 },
    { id: "t_iconic", label: "Iconic", order: 3 },
  ];
  store.defaultTierId = "t_retail";
  return store;
}

function plainProduct(): Product {
  return {
    id: "p1",
    storeId: "store_olivia",
    name: "Perfume Chanel Chance 100 ml",
    category: "perfume",
    isPublic: true,
    quantityOnHand: 4,
    cost: 400,
    createdAt: NOW,
    updatedAt: NOW,
  } as Product;
}

function variantProduct(): Product {
  return {
    ...plainProduct(),
    id: "p2",
    name: "Cartera de piel",
    category: "other",
    quantityOnHand: undefined,
    variants: [{ id: "v-cafe", color: "Café", quantityOnHand: 3, createdAt: NOW, updatedAt: NOW }],
  } as Product;
}

const orderDoc = (id: string, extra: Partial<Order> = {}): Order =>
  ({
    id,
    storeId: "store_olivia",
    customerId: "c1",
    customerName: "Lucía",
    items: [
      { productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 2, unitPrice: 950, subtotal: 1900, cost: 400, lineId: `${id}_L0` },
      { productName: "Cartera de piel", productId: "p2", variantId: "v-cafe", variantColor: "Café", quantity: 3, unitPrice: 680, subtotal: 2040, cost: 300, lineId: `${id}_L1` },
    ],
    deposit: 0,
    orderStatus: "confirmed",
    paymentStatus: "unpaid",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  }) as Order;

let state: ReturnType<typeof fixtureState>;

function mount() {
  return render(
    <ToastProvider>
      <PointsOfSaleScreen />
    </ToastProvider>
  );
}

beforeEach(() => {
  state = fixtureState();
  mocks.state = state;
  state.stores[0] = tieredStore();
  state.products = [plainProduct(), variantProduct()];
  state.orders = [orderDoc("order-ok"), orderDoc("order-paid", { paymentsReceivedCents: 5000 })];
  mocks.savePoint.mockReset();
  mocks.savePoint.mockResolvedValue(undefined);
  mocks.convertOrderToFirstSurtido.mockReset();
  mocks.convertOrderToFirstSurtido.mockResolvedValue({ converted: true, entryCount: 2, units: 5 });
});

describe("Puntos de venta (#524 primer corte UI)", () => {
  it("tienda bajo pedido: explica que la función necesita inventario", () => {
    state.stores[0] = { ...tieredStore(), type: "on_demand" } as Store;
    mount();
    expect(screen.getByText("Los puntos de venta usan el inventario de tu tienda")).toBeTruthy();
  });

  it("lista vacía ofrece crear el primer punto; crear guarda con valores del piloto", async () => {
    mount();
    expect(screen.getByText("Aún no tienes puntos de venta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crear el primer punto" }));
    fireEvent.change(screen.getByLabelText("Nombre del punto"), { target: { value: "Mostrador centro" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear punto" }));
    await screen.findByText(/creado/i);
    expect(mocks.savePoint).toHaveBeenCalledTimes(1);
    const saved = mocks.savePoint.mock.calls[0][0];
    expect(saved.id).toBe("store_olivia__mostrador-centro");
    expect(saved.storeId).toBe("store_olivia");
    expect(saved.active).toBe(true);
    expect(saved.commissionRate).toBe(0.2);
    expect(saved.priceTierId).toBe("t_retail");
  });

  it("la ficha vacía ofrece «Usar como surtido inicial»: los pedidos con cobros quedan deshabilitados con motivo", () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, createdAt: NOW, updatedAt: NOW },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Usar como surtido inicial" }));
    // El pedido limpio está habilitado; el pagado explica su impedimento.
    const paid = screen.getByText(/cobros registrados/).closest("button");
    expect(paid).toBeDisabled();
    expect(screen.getByText(/Listo para surtir/)).toBeTruthy();
  });

  it("vista previa y confirmación: entradas exactas y llamada al callable de confianza", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, createdAt: NOW, updatedAt: NOW },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Usar como surtido inicial" }));
    fireEvent.click(screen.getByText(/Listo para surtir/).closest("button") ?? screen.getByText(/Listo para surtir/));
    // Vista previa: piezas, variantes y totales del botón.
    expect(screen.getByText("Perfume Chanel Chance 100 ml")).toBeTruthy();
    expect(screen.getByText(/Café/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Surtir 5 piezas/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Surtir 5 piezas/ }));
    await screen.findByText(/Surtido inicial listo/i);
    expect(mocks.convertOrderToFirstSurtido).toHaveBeenCalledTimes(1);
    expect(mocks.convertOrderToFirstSurtido.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: "store_olivia__mostrador",
      orderId: "order-ok",
    });
    expect(mocks.convertOrderToFirstSurtido.mock.calls[0][0].physicalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("un punto con entradas muestra piezas y valores; el costo pendiente se nombra", () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, createdAt: NOW, updatedAt: NOW },
    ];
    const entry = (over: Partial<PointEntry> = {}): PointEntry =>
      ({
        id: "pe1",
        storeId: "store_olivia",
        pointId: "store_olivia__mostrador",
        productId: "p1",
        productName: "Perfume Chanel Chance 100 ml",
        entryDate: "2026-11-21",
        quantity: 5,
        consumedQty: 2,
        markedPriceCents: 95000,
        unitCostCents: 40000,
        createdAt: NOW,
        updatedAt: NOW,
        ...over,
      }) as PointEntry;
    state.pointEntries = [entry(), entry({ id: "pe2", unitCostCents: undefined, productId: "p2", productName: "Cartera de piel", variantColor: "Café" })];
    mount();
    expect(screen.getByText("6 piezas")).toBeTruthy(); // 2 entradas × (5 − 2) restantes
    expect(screen.getByText(/Valor al precio marcado/)).toBeTruthy();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.getAllByText(/costo pendiente/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 de 5/).length).toBe(2); // una por entrada
  });
});

describe("#524 review: candidatos con escala, búsqueda y fecha real", () => {
  function withPoint() {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, createdAt: NOW, updatedAt: NOW },
    ];
  }

  it("los pedidos ya convertidos no aparecen como candidatos (el conjunto no crece)", () => {
    withPoint();
    state.orders = [orderDoc("order-ok"), orderDoc("order-done", { convertedToPointId: "store_olivia__mostrador" })];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Usar como surtido inicial" }));
    expect(screen.getByText("1 pedido(s) confirmado(s) abierto(s)")).toBeTruthy();
    expect(screen.queryByText("Ya convertido")).toBeNull();
  });

  it("la búsqueda por clienta filtra los candidatos", () => {
    withPoint();
    state.orders = [
      orderDoc("order-a", { customerName: "Lucía", createdAt: "2026-11-20T10:00:00.000Z" }),
      orderDoc("order-b", { customerName: "María", createdAt: "2026-11-21T10:00:00.000Z" }),
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Usar como surtido inicial" }));
    expect(screen.getByText("2 pedido(s) confirmado(s) abierto(s)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "maría" } });
    expect(screen.getByText("1 pedido(s) confirmado(s) abierto(s)")).toBeTruthy();
    expect(screen.getByText(/María/)).toBeTruthy();
    expect(screen.queryByText(/Lucía/)).toBeNull();
  });

  it("una fecha física que no es fecha real deshabilita la confirmación", () => {
    withPoint();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Usar como surtido inicial" }));
    fireEvent.click(screen.getByText(/Listo para surtir/).closest("button") ?? screen.getByText(/Listo para surtir/));
    fireEvent.change(screen.getByLabelText("Fecha física de entrega"), { target: { value: "2026-13-99" } });
    expect(screen.getByRole("button", { name: /Surtir 5 piezas/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fecha física de entrega"), { target: { value: "2026-11-21" } });
    expect(screen.getByRole("button", { name: /Surtir 5 piezas/ })).toBeEnabled();
  });
});
