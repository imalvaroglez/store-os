// @vitest-environment jsdom
// #524 — Ventas → Puntos de venta, first UI cut: the list with live
// pieces/valuation, point creation with pilot defaults, and the
// «Usar como surtido inicial» preview + trusted conversion call.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PointsOfSaleScreen } from "./PointsOfSaleScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Order, PointEntry, Product, Store } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  savePoint: vi.fn(),
  convertOrderToFirstSurtido: vi.fn(),
  registerPointCut: vi.fn(),
  registerPointCutPayment: vi.fn(),
  correctPointCut: vi.fn(),
  stockPoint: vi.fn(),
  withdrawFromPoint: vi.fn(),
  annulPointCut: vi.fn(),
  deliverPointExhibitors: vi.fn(),
  confirmExhibitorCost: vi.fn(),
  withdrawPointExhibitors: vi.fn(),
  closes: [] as Array<{ period: string }>,
}));

vi.mock("../../app/firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/firebase/firestoreData")>();
  return {
    ...actual,
    loadClosesForStore: vi.fn(async () => mocks.closes as never[]),
  };
});
vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      savePoint: mocks.savePoint,
      convertOrderToFirstSurtido: mocks.convertOrderToFirstSurtido,
      registerPointCut: mocks.registerPointCut,
      registerPointCutPayment: mocks.registerPointCutPayment,
      correctPointCut: mocks.correctPointCut,
      stockPoint: mocks.stockPoint,
      withdrawFromPoint: mocks.withdrawFromPoint,
      annulPointCut: mocks.annulPointCut,
      deliverPointExhibitors: mocks.deliverPointExhibitors,
      confirmExhibitorCost: mocks.confirmExhibitorCost,
      withdrawPointExhibitors: mocks.withdrawPointExhibitors,
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
    prices: { t_retail: 950, t_girly: 780, t_iconic: 580 },
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
  mocks.registerPointCut.mockReset();
  mocks.registerPointCut.mockResolvedValue({ registered: true, corteId: "corte_x", totals: { netCents: 40000 } });
  mocks.registerPointCutPayment.mockReset();
  mocks.registerPointCutPayment.mockResolvedValue({ registered: true, amountCents: 40000 });
  mocks.correctPointCut.mockReset();
  mocks.correctPointCut.mockResolvedValue({ corrected: true, corteId: "corte_corr_n1", totals: { netCents: 108800 } });
  mocks.stockPoint.mockReset();
  mocks.stockPoint.mockResolvedValue({ stocked: true, entryCount: 1, units: 2 });
  mocks.withdrawFromPoint.mockReset();
  mocks.withdrawFromPoint.mockResolvedValue({ withdrawn: true, units: 1 });
  mocks.annulPointCut.mockReset();
  mocks.annulPointCut.mockResolvedValue({ registered: true });
  mocks.deliverPointExhibitors.mockReset();
  mocks.deliverPointExhibitors.mockResolvedValue({ delivered: true, pieces: 4 });
  mocks.confirmExhibitorCost.mockReset();
  mocks.confirmExhibitorCost.mockResolvedValue({ confirmed: 1 });
  mocks.withdrawPointExhibitors.mockReset();
  mocks.withdrawPointExhibitors.mockResolvedValue({ withdrawn: true, pieces: 1 });
  mocks.closes = [];
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

describe("#524 corte en la ficha: captura, resumen vivo y cobro diferido", () => {
  const ISSUE_ENTRY: PointEntry = {
    id: "pe1", storeId: "store_olivia", pointId: "store_olivia__mostrador", productId: "p1",
    productName: "Reloj Citizen", entryDate: "2026-11-01", quantity: 10, consumedQty: 0,
    markedPriceCents: 10000, unitCostCents: 5000, createdAt: NOW, updatedAt: NOW,
  };

  function withPointAndStock() {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [ISSUE_ENTRY];
  }

  it("el ejemplo de la issue en vivo: vender 5 y dar de baja 1 con 20% muestra el resumen exacto y llama al callable", async () => {
    withPointAndStock();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar corte" }));
    fireEvent.change(screen.getByLabelText("Vendidas"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar baja" }));
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Pieza perdida" } });
    // Resumen vivo con las cifras de la issue.
    expect(screen.getByText("Venta bruta").closest("div")?.textContent).toContain("500");
    expect(screen.getByText(/Neto a cobrar/).closest("div")?.textContent).toContain("400");
    expect(screen.getByText(/Resultado del corte/).closest("div")?.textContent).toContain("100");
    expect(screen.getByText(/Quedan 4 piezas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Registrar corte" }));
    await screen.findByText(/Corte registrado/i);
    expect(mocks.registerPointCut).toHaveBeenCalledTimes(1);
    expect(mocks.registerPointCut.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: "store_olivia__mostrador",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 5 }],
      writeOffs: [{ productId: "p1", markedPriceCents: 10000, qty: 1, reason: "Pieza perdida" }],
    });
  });

  it("vender más de lo disponible bloquea el registro y explica", () => {
    withPointAndStock();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar corte" }));
    fireEvent.change(screen.getByLabelText("Vendidas"), { target: { value: "11" } });
    expect(screen.getByText(/faltan/i)).toBeTruthy();
    expect((screen.getAllByRole("button", { name: "Registrar corte" }).slice(-1)[0])).toBeDisabled();
    expect(mocks.registerPointCut).not.toHaveBeenCalled();
  });

  it("cobro diferido: importa el neto completo, fecha real y medio", async () => {
    withPointAndStock();
    state.pointOperations = [
      {
        id: "corte_previo", storeId: "store_olivia", pointId: "store_olivia__mostrador", kind: "corte",
        status: "pendiente_de_cobro", effectiveDate: "2026-11-21", confirmedBy: "u1", confirmedAt: NOW,
        totals: { grossSaleCents: 50000, commissionCents: 10000, netCents: 40000, soldCostCents: 25000, pendingCostUnits: 0, writeOffCostCents: 0, writeOffPendingUnits: 0, resultCents: 15000, remainingUnits: 4 },
      },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.getByText("Cortes del punto")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    expect(screen.getAllByText(/\$400/).length).toBeGreaterThan(0); // importe propuesto completo
    fireEvent.change(screen.getByLabelText("Fecha real del cobro"), { target: { value: "2026-12-03" } });
    // El botón del DIÁLOGO es el último «Registrar cobro» visible (el de la
    // lista sigue presente detrás).
    const payButtons = screen.getAllByRole("button", { name: "Registrar cobro" });
    fireEvent.click(payButtons[payButtons.length - 1]);
    await screen.findByText(/Cobro registrado/i);
    expect(mocks.registerPointCutPayment).toHaveBeenCalledWith(
      expect.objectContaining({ corteId: "corte_previo", method: "cash", date: "2026-12-03" })
    );
  });
});

describe("#524 surtir del almacén y retirar en la ficha", () => {
  it("surtir propone el precio del nivel del punto y llama al callable con centavos exactos", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Surtir del almacén" }));
    // El perfume del almacén (4 disponibles, Regular $950) aparece con su precio sugerido.
    expect(screen.getByText(/4 en almacén/)).toBeTruthy();
    expect((screen.getByLabelText("Precio de etiqueta de Perfume Chanel Chance 100 ml") as HTMLInputElement).value).toBe("950");
    fireEvent.change(screen.getByLabelText("Cantidad de Perfume Chanel Chance 100 ml"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Perfume Chanel Chance 100 ml" }));
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    await screen.findByText(/Surtido: 2 piezas/i);
    expect(mocks.stockPoint).toHaveBeenCalledTimes(1);
    expect(mocks.stockPoint.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: "store_olivia__mostrador",
      lines: [{ productId: "p1", qty: 2, markedPriceCents: 95000 }],
    });
    expect(mocks.stockPoint.mock.calls[0][0].physicalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("regresión multilínea: una confirmación guarda todas las líneas de búsquedas sucesivas aunque la última siga activa", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [];
    mocks.stockPoint.mockResolvedValue({ stocked: true, entryCount: 2, units: 3 });
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Surtir del almacén" }));
    // Búsqueda 1: el perfume; agrega 2 piezas.
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Perfume" } });
    fireEvent.change(screen.getByLabelText("Cantidad de Perfume Chanel Chance 100 ml"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Perfume Chanel Chance 100 ml" }));
    // Búsqueda 2: la cartera; agrega 1 pieza. La búsqueda anterior sigue
    // filtrando lo visible, pero la captura ya hecha no se pierde.
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Cartera" } });
    fireEvent.change(screen.getByLabelText("Cantidad de Cartera de piel · Café"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Cartera de piel · Café" }));
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    await screen.findByText(/Surtido: 3 piezas/i);
    expect(mocks.stockPoint).toHaveBeenCalledTimes(1);
    expect(mocks.stockPoint.mock.calls[0][0].lines).toHaveLength(2);
    expect(mocks.stockPoint.mock.calls[0][0].lines).toEqual(
      expect.arrayContaining([
        { productId: "p1", qty: 2, markedPriceCents: 95000 },
        { productId: "p2", variantId: "v-cafe", qty: 1, markedPriceCents: 95000 },
      ])
    );
  });

  it("retirar agrupa por producto y color del punto y devuelve al almacén", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [
      { id: "pe1", storeId: "store_olivia", pointId: "store_olivia__mostrador", productId: "p1", productName: "Perfume", entryDate: "2026-11-01", quantity: 2, consumedQty: 0, markedPriceCents: 95000, unitCostCents: 40000, createdAt: NOW, updatedAt: NOW } as PointEntry,
      { id: "pe2", storeId: "store_olivia", pointId: "store_olivia__mostrador", productId: "p2", variantId: "v-cafe", productName: "Cartera", variantColor: "Café", entryDate: "2026-11-01", quantity: 3, consumedQty: 1, markedPriceCents: 68000, unitCostCents: 30000, createdAt: NOW, updatedAt: NOW } as PointEntry,
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    // Filas por dimensión con sus existencias en el punto.
    expect(screen.getAllByText(/2 en el punto/).length).toBe(2); // perfume y cartera
    fireEvent.change(screen.getAllByLabelText("Piezas")[1], { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar piezas" }));
    await screen.findByText(/Retiro: 1 piezas/i);
    expect(mocks.withdrawFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "store_olivia",
        pointId: "store_olivia__mostrador",
        lines: [{ productId: "p2", variantId: "v-cafe", qty: 1 }],
      })
    );
  });
});

describe("#524 anulación de corte en la ficha con mes-abierto", () => {
  const CORTE = {
    id: "corte_latest", storeId: "store_olivia", pointId: "store_olivia__mostrador", kind: "corte" as const,
    status: "pendiente_de_cobro" as const, effectiveDate: "2026-11-21", confirmedBy: "u1", confirmedAt: "2026-11-21T12:00:00.000Z",
    totals: { grossSaleCents: 50000, commissionCents: 10000, netCents: 40000, soldCostCents: 25000, pendingCostUnits: 0, writeOffCostCents: 0, writeOffPendingUnits: 0, resultCents: 15000, remainingUnits: 4 },
  };

  function withCorte() {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointOperations = [CORTE];
  }

  it("mes abierto: pide motivo, llama al callable y confirma la reposición", async () => {
    withCorte();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Anular corte" }));
    expect(screen.getByText(/vuelven exactamente como estaban/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Se capturó dos veces" } });
    const buttons = screen.getAllByRole("button", { name: "Anular corte" });
    fireEvent.click(buttons[buttons.length - 1]);
    await screen.findByText(/Corte anulado/i);
    expect(mocks.annulPointCut).toHaveBeenCalledWith(
      expect.objectContaining({ corteId: "corte_latest", storeId: "store_olivia", motive: "Se capturó dos veces" })
    );
  });

  it("mes con cierre autorizado: no ofrece anulación ni corrección y dirige a la revisión de ajustes", async () => {
    withCorte();
    mocks.closes = [{ period: "2026-11" }];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    // #583: el registro informa el impedimento en la fila — jamás ofrece una
    // confirmación que el servidor rechazaría.
    await screen.findByText(/cierre autorizado/i);
    expect(screen.queryByRole("button", { name: "Anular corte" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Corregir corte" })).toBeNull();
    expect(screen.getByText(/cierre autorizado/i)).toBeTruthy();
    expect(screen.getByText(/revisi[oó]n de ajustes/i)).toBeTruthy();
    expect(screen.queryByLabelText("Motivo")).toBeNull();
    expect(mocks.annulPointCut).not.toHaveBeenCalled();
  });

  it("un corte ya cobrado o sin cortes pendientes no ofrece anulación", () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointOperations = [{ ...CORTE, status: "cobrado" as const }];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.queryByRole("button", { name: "Anular corte" })).toBeNull();
  });
});

describe("#524 M1 — el reintento tras respuesta perdida reutiliza la intención", () => {
  const ISSUE_ENTRY: PointEntry = {
    id: "pe1", storeId: "store_olivia", pointId: "store_olivia__mostrador", productId: "p1",
    productName: "Reloj Citizen", entryDate: "2026-11-01", quantity: 10, consumedQty: 0,
    markedPriceCents: 10000, unitCostCents: 5000, createdAt: NOW, updatedAt: NOW,
  };
  function withPoint() {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [ISSUE_ENTRY];
  }

  it("corte: el reintento lleva el MISMO intentId; un corte nuevo lleva otro", async () => {
    withPoint();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar corte" }));
    fireEvent.change(screen.getByLabelText("Vendidas"), { target: { value: "5" } });
    mocks.registerPointCut.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.click(screen.getAllByRole("button", { name: "Registrar corte" }).slice(-1)[0]);
    await screen.findByText(/Network request failed/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Registrar corte" }).slice(-1)[0]);
    await screen.findByText(/Corte registrado/i);
    expect(mocks.registerPointCut).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.registerPointCut.mock.calls;
    expect(first[0].intentId).toBeTruthy();
    expect(second[0].intentId).toBe(first[0].intentId);
    // un corte NUEVO (captura reabierta) recibe su propia intención
    fireEvent.click(screen.getByRole("button", { name: "Registrar corte" }));
    fireEvent.change(screen.getByLabelText("Vendidas"), { target: { value: "1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Registrar corte" }).slice(-1)[0]);
    await screen.findByText(/Corte registrado.*2|Quedan/i);
    const third = mocks.registerPointCut.mock.calls[2];
    expect(third[0].intentId).not.toBe(first[0].intentId);
  });

  it("cobro: el reintento lleva el MISMO intentId", async () => {
    withPoint();
    state.pointOperations = [
      {
        id: "corte_previo", storeId: "store_olivia", pointId: "store_olivia__mostrador", kind: "corte" as const,
        status: "pendiente_de_cobro" as const, effectiveDate: "2026-11-21", confirmedBy: "u1", confirmedAt: NOW,
        totals: { grossSaleCents: 50000, commissionCents: 10000, netCents: 40000, soldCostCents: 25000, pendingCostUnits: 0, writeOffCostCents: 0, writeOffPendingUnits: 0, resultCents: 15000, remainingUnits: 4 },
      },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    mocks.registerPointCutPayment.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Registrar cobro" }).slice(-1)[0]);
    await screen.findByText(/Network request failed/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Registrar cobro" }).slice(-1)[0]);
    await screen.findByText(/Cobro registrado/i);
    const [first, second] = mocks.registerPointCutPayment.mock.calls;
    expect(first[0].intentId).toBeTruthy();
    expect(second[0].intentId).toBe(first[0].intentId);
  });

  it("anulación: el reintento lleva el MISMO intentId", async () => {
    withPoint();
    state.pointOperations = [
      {
        id: "corte_previo", storeId: "store_olivia", pointId: "store_olivia__mostrador", kind: "corte" as const,
        status: "pendiente_de_cobro" as const, effectiveDate: "2026-11-21", confirmedBy: "u1", confirmedAt: NOW,
        totals: { grossSaleCents: 50000, commissionCents: 10000, netCents: 40000, soldCostCents: 25000, pendingCostUnits: 0, writeOffCostCents: 0, writeOffPendingUnits: 0, resultCents: 15000, remainingUnits: 4 },
      },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Anular corte" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Error de captura" } });
    mocks.annulPointCut.mockRejectedValueOnce(new Error("Network request failed"));
    const annulConfirm = screen.getAllByRole("button", { name: "Anular corte" }).slice(-1)[0];
    fireEvent.click(annulConfirm);
    await screen.findByText(/Network request failed/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Anular corte" }).slice(-1)[0]);
    await screen.findByText(/Corte anulado/i);
    const [first, second] = mocks.annulPointCut.mock.calls;
    expect(first[0].intentId).toBeTruthy();
    expect(second[0].intentId).toBe(first[0].intentId);
  });

  it("surtir: el reintento lleva el MISMO intentId y la MISMA carga", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Surtir del almacén" }));
    fireEvent.change(screen.getByLabelText("Cantidad de Perfume Chanel Chance 100 ml"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Perfume Chanel Chance 100 ml" }));
    mocks.stockPoint.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    await screen.findByText(/Network request failed/i);
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    await screen.findByText(/Surtido:/i);
    const [first, second] = mocks.stockPoint.mock.calls;
    // #524 revisión: la intención debe EXISTIR — "" === "" sería una prueba vacía
    // (así se detectó el botón de surtido que no acuñaba).
    expect(first[0].intentId).toBeTruthy();
    expect(second[0].intentId).toBe(first[0].intentId);
    // #569: la carga del reintento es idéntica — una edición tras respuesta
    // perdida nunca se envía como confirmación nueva.
    expect(second[0].lines).toEqual(first[0].lines);
    expect(second[0].physicalDate).toBe(first[0].physicalDate);
  });

  it("retirar: el reintento lleva el MISMO intentId", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [
      { id: "pe1", storeId: "store_olivia", pointId: "store_olivia__mostrador", productId: "p1", productName: "Perfume", entryDate: "2026-11-01", quantity: 4, consumedQty: 0, markedPriceCents: 95000, unitCostCents: 40000, createdAt: NOW, updatedAt: NOW } as PointEntry,
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    fireEvent.change(screen.getAllByLabelText("Piezas")[0], { target: { value: "2" } });
    mocks.withdrawFromPoint.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.click(screen.getByRole("button", { name: "Retirar piezas" }));
    await screen.findByText(/Network request failed/i);
    fireEvent.click(screen.getByRole("button", { name: "Retirar piezas" }));
    await screen.findByText(/Retiro:/i);
    const [first, second] = mocks.withdrawFromPoint.mock.calls;
    expect(first[0].intentId).toBeTruthy();
    expect(second[0].intentId).toBe(first[0].intentId);
  });
});

describe("#524 Exhibidores: pestaña, entrega, costo y retiro", () => {
  const POINT_ID = "store_olivia__mostrador";

  function withPoint() {
    state.points = [
      { id: POINT_ID, storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
  }

  function exhibitor(over: Partial<import("../../types").PointExhibitor> = {}): import("../../types").PointExhibitor {
    return {
      id: "pex_d1_0",
      storeId: "store_olivia",
      pointId: POINT_ID,
      deliveryId: "d1",
      lineIndex: 0,
      name: "Tabla",
      deliveredAt: "2026-11-01",
      opening: true,
      unitCostCents: 10400,
      deliveredBy: "u1",
      createdAt: NOW,
      ...over,
    };
  }

  /** La misión del PO: apertura 2×$104 + $58 + $72 = $338; +$90 posterior. */
  function missionPieces(): Array<import("../../types").PointExhibitor> {
    return [
      exhibitor({ id: "pex_d1_0" }),
      exhibitor({ id: "pex_d1_1" }),
      exhibitor({ id: "pex_d1_2", lineIndex: 1, name: "Exhibidor chico", unitCostCents: 5800 }),
      exhibitor({ id: "pex_d1_3", lineIndex: 2, name: "Exhibidor grande", unitCostCents: 7200 }),
      exhibitor({ id: "pex_d2_0", deliveryId: "d2", lineIndex: 0, name: "Exhibidor mediano", deliveredAt: "2026-11-15", opening: false, unitCostCents: 9000 }),
    ];
  }

  function openExhibidoresTab() {
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("tab", { name: "Exhibidores" }));
  }

  it("la pestaña arranca vacía y ofrece registrar la primera entrega", () => {
    withPoint();
    openExhibidoresTab();
    expect(screen.getByText("Este punto todavía no tiene exhibidores")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Registrar entrega" })).toBeTruthy();
    // La pestaña Mercancía sigue disponible y es la predeterminada.
    expect(screen.getByRole("tab", { name: "Mercancía" })).toBeTruthy();
  });

  it("misión viva: apertura $338 y asignado $338; retirar una tabla deja 338/324", () => {
    withPoint();
    state.pointExhibitors = missionPieces();
    openExhibidoresTab();
    expect(screen.getByText(/Costo de apertura/).textContent).toContain("338");
    expect(screen.getByText(/Costo de exhibidores asignados/).textContent).toContain("428");
    // Retiro de una tabla: la pieza más antigua sale; la apertura no se reduce.
    cleanup();
    state.pointExhibitors = missionPieces().map((piece, index) =>
      index === 0 ? { ...piece, withdrawnAt: "2026-11-20", withdrawnBy: "u2", withdrawalIntentionId: "w1" } : piece
    );
    openExhibidoresTab();
    expect(screen.getByText(/Costo de apertura/).textContent).toContain("338");
    expect(screen.getByText(/Costo de exhibidores asignados/).textContent).toContain("324");
    expect(screen.getByText(/entregado 1 nov/).textContent).toContain("retirado 20 nov");
  });

  it("entrega con renglones y apertura: llamada exacta al callable", async () => {
    withPoint();
    openExhibidoresTab();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    fireEvent.change(screen.getAllByLabelText("Exhibidor")[0], { target: { value: "Tabla" } });
    fireEvent.change(screen.getAllByLabelText("Piezas")[0], { target: { value: "2" } });
    fireEvent.change(screen.getAllByLabelText("Costo por pieza")[0], { target: { value: "104" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar exhibidor" }));
    fireEvent.change(screen.getAllByLabelText("Exhibidor")[1], { target: { value: "Exhibidor chico" } });
    fireEvent.change(screen.getAllByLabelText("Piezas")[1], { target: { value: "1" } });
    fireEvent.change(screen.getAllByLabelText("Costo por pieza")[1], { target: { value: "58" } });
    fireEvent.click(screen.getByLabelText(/Entrega de apertura/));
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }));
    await screen.findByText(/Entrega registrada: \d+ exhibidores de apertura\./i);
    expect(mocks.deliverPointExhibitors).toHaveBeenCalledTimes(1);
    expect(mocks.deliverPointExhibitors.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: POINT_ID,
      opening: true,
      lines: [
        { name: "Tabla", quantity: 2, unitCostCents: 10400 },
        { name: "Exhibidor chico", quantity: 1, unitCostCents: 5800 },
      ],
    });
    expect(mocks.deliverPointExhibitors.mock.calls[0][0].physicalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mocks.deliverPointExhibitors.mock.calls[0][0].intentId).toBeTruthy();
  });

  it("costo pendiente: el total lo nombra y la confirmación va por pieza", async () => {
    withPoint();
    state.pointExhibitors = [
      ...missionPieces(),
      exhibitor({ id: "pex_d3_0", deliveryId: "d3", lineIndex: 0, name: "Barral", deliveredAt: "2026-11-18", opening: false, unitCostCents: undefined }),
    ];
    openExhibidoresTab();
    expect(screen.getByText(/Costo de exhibidores asignados/).textContent).toContain("428");
    expect(screen.getByText(/1 sin valorar/)).toBeTruthy();
    expect(screen.getByText(/1 con costo pendiente/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Confirmar costo" })[0]);
    fireEvent.change(screen.getByLabelText("Costo por pieza"), { target: { value: "58" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Confirmar costo" }).slice(-1)[0]);
    await screen.findByText(/Costo confirmado/i);
    expect(mocks.confirmExhibitorCost).toHaveBeenCalledTimes(1);
    expect(mocks.confirmExhibitorCost.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: POINT_ID,
      items: [{ exhibitorId: "pex_d3_0", unitCostCents: 5800 }],
    });
  });

  it("retirar exhibidores: la línea lleva entrega y renglón exactos", async () => {
    withPoint();
    state.pointExhibitors = missionPieces();
    openExhibidoresTab();
    fireEvent.click(screen.getByRole("button", { name: "Retirar exhibidores" }));
    const tablaRow = screen.getAllByLabelText("Piezas")[0];
    fireEvent.change(tablaRow, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    await screen.findByText(/Retiro registrado: 1 exhibidor/i);
    expect(mocks.withdrawPointExhibitors).toHaveBeenCalledTimes(1);
    expect(mocks.withdrawPointExhibitors.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: POINT_ID,
      lines: [{ deliveryId: "d1", lineIndex: 0, quantity: 1 }],
    });
    expect(mocks.withdrawPointExhibitors.mock.calls[0][0].intentId).toBeTruthy();
  });

  it("entrega: el reintento lleva el MISMO intentId no vacío", async () => {
    withPoint();
    openExhibidoresTab();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    fireEvent.change(screen.getAllByLabelText("Exhibidor")[0], { target: { value: "Tabla" } });
    fireEvent.change(screen.getAllByLabelText("Piezas")[0], { target: { value: "2" } });
    mocks.deliverPointExhibitors.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }));
    await screen.findByText(/Network request failed/i);
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }));
    await screen.findByText(/Entrega registrada/i);
    const [first, second] = mocks.deliverPointExhibitors.mock.calls;
    expect(first[0].intentId).toBeTruthy();
    expect(second[0].intentId).toBe(first[0].intentId);
  });

  it("los exhibidores no tocan las cifras de mercancía de la ficha", () => {
    withPoint();
    state.pointExhibitors = missionPieces();
    state.pointEntries = [
      { id: "pe1", storeId: "store_olivia", pointId: POINT_ID, productId: "p1", productName: "Perfume", entryDate: "2026-11-01", quantity: 5, consumedQty: 0, markedPriceCents: 10000, unitCostCents: 5000, createdAt: NOW, updatedAt: NOW } as PointEntry,
    ];
    openExhibidoresTab();
    fireEvent.click(screen.getByRole("tab", { name: "Mercancía" }));
    // Valor al costo sigue siendo el de las ENTRADAS de mercancía (5 × $50).
    expect(screen.getByText(/Valor al costo/).textContent).toContain("250");
    expect(screen.getByText(/Valor al precio marcado/).textContent).toContain("500");
  });
});

describe("#569 surtido directo con variantes y captura en lote", () => {
  const ANILLO = "Anillo Ajustable Nombre Largo Brillante";

  /** El ejemplo de la issue: dos variantes con precio propio, una agotada,
   * un producto sin variantes y un diseño con precio compartido/ausente. */
  function surtidoProducts(): Product[] {
    const variant = (id: string, color: string, quantityOnHand: number, cost: number | undefined, prices?: Record<string, number>) =>
      ({ id, color, quantityOnHand, ...(cost !== undefined ? { cost } : {}), ...(prices ? { prices } : {}), createdAt: NOW, updatedAt: NOW });
    return [
      {
        id: "p-anillo",
        storeId: "store_olivia",
        name: ANILLO,
        category: "jewelry",
        isPublic: true,
        quantityOnHand: undefined,
        variants: [
          variant("v-dorado", "Dorado", 8, 65, { t_retail: 160 }),
          variant("v-plateado", "Plateado", 8, 68, { t_retail: 165 }),
          variant("v-rosa", "Rosa", 0, 70, { t_retail: 170 }),
        ],
      },
      {
        id: "p-reloj",
        storeId: "store_olivia",
        name: "Reloj B",
        category: "jewelry",
        isPublic: true,
        quantityOnHand: 12,
        cost: 45,
        prices: { t_retail: 120 },
      },
      {
        id: "p-arete",
        storeId: "store_olivia",
        name: "Arete C",
        category: "jewelry",
        isPublic: true,
        quantityOnHand: undefined,
        prices: { t_retail: 100 },
        variants: [
          variant("v-oro", "Oro", 5, undefined), // comparte el precio del diseño
          variant("v-perla", "Perla", 5, 40, { t_girly: 90 }), // mapa propio SIN el nivel del punto
        ],
      },
    ] as Product[];
  }

  function withEmptyPoint(products: Product[] = surtidoProducts()) {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [];
    state.orders = [];
    state.products = products;
  }

  function openDialog() {
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Surtir del almacén" }));
  }

  it("ficha vacía: «Surtir del almacén» es la acción principal y abre sin pedidos; la conversión queda como alternativa", () => {
    withEmptyPoint();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    const surtir = screen.getByRole("button", { name: "Surtir del almacén" });
    expect(surtir).toBeEnabled();
    expect(screen.getByRole("button", { name: "Usar como surtido inicial" })).toBeTruthy();
    fireEvent.click(surtir);
    // El diálogo abre sobre el almacén disponible, sin pedir un pedido.
    expect(screen.getByText("Dorado")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Agregar ${ANILLO} · Dorado` })).toBeEnabled();
  });

  it("buscar «Dorado» muestra el diseño una vez con sus hermanas; la variante agotada queda visible sin captura", () => {
    withEmptyPoint();
    openDialog();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Dorado" } });
    expect(screen.getAllByText(ANILLO).length).toBe(1);
    expect(screen.getByText("Dorado")).toBeTruthy();
    expect(screen.getByText("Plateado")).toBeTruthy(); // la hermana llega con la coincidencia
    expect(screen.getByText("Rosa")).toBeTruthy(); // la agotada no se esconde tras la búsqueda
    expect(screen.getByText(/Sin existencias/)).toBeTruthy();
    expect(screen.getByRole("button", { name: `Agregar ${ANILLO} · Rosa` })).toBeDisabled();
    expect(screen.queryByText("Reloj B")).toBeNull(); // los demás diseños no
  });

  it("misión del ejemplo: dos variantes con precios propios + producto sin variantes en UNA confirmación exacta", async () => {
    withEmptyPoint();
    mocks.stockPoint.mockResolvedValue({ stocked: true, entryCount: 3, units: 5 });
    openDialog();
    // La vista inicial prioriza lo disponible: Rosa (agotada) no aparece.
    expect(screen.queryByText("Rosa")).toBeNull();
    fireEvent.change(screen.getByLabelText(`Cantidad de ${ANILLO} · Dorado`), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(`Precio de etiqueta de ${ANILLO} · Dorado`), { target: { value: "169.50" } });
    fireEvent.click(screen.getByRole("button", { name: `Agregar ${ANILLO} · Dorado` }));
    // Plateado conserva su sugerido propio (165), no el de su hermana.
    fireEvent.change(screen.getByLabelText(`Cantidad de ${ANILLO} · Plateado`), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: `Agregar ${ANILLO} · Plateado` }));
    // Una búsqueda nueva no quita ni confirma lo ya capturado.
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Reloj B" } });
    fireEvent.change(screen.getByLabelText("Cantidad de Reloj B"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Reloj B" }));
    // El foco cae en el renglón recién agregado, no se pierde.
    expect(document.activeElement).toBe(screen.getByLabelText("Cantidad a surtir de Reloj B"));
    expect(screen.getByText("Piezas para surtir")).toBeTruthy();
    expect(screen.getByText(/5 piezas en 3 renglones/)).toBeTruthy();
    expect(screen.getByText(/destino Mostrador centro/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    await screen.findByText(/Surtido: 5 piezas/i);
    expect(mocks.stockPoint).toHaveBeenCalledTimes(1);
    expect(mocks.stockPoint.mock.calls[0][0].lines).toEqual([
      { productId: "p-anillo", variantId: "v-dorado", qty: 2, markedPriceCents: 16950 },
      { productId: "p-anillo", variantId: "v-plateado", qty: 1, markedPriceCents: 16500 },
      { productId: "p-reloj", qty: 2, markedPriceCents: 12000 },
    ]);
    expect(mocks.stockPoint.mock.calls[0][0].intentId).toBeTruthy();
    expect(mocks.stockPoint.mock.calls[0][0].pointId).toBe("store_olivia__mostrador");
    // El punto sigue abierto tras el surtido.
    expect(screen.getAllByText("Mostrador centro").length).toBeGreaterThan(1);
  });

  it("un renglón agregado queda «Agregado» (sin duplicar) y «Quitar» lo libera", () => {
    withEmptyPoint();
    openDialog();
    fireEvent.change(screen.getByLabelText(`Cantidad de ${ANILLO} · Dorado`), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: `Agregar ${ANILLO} · Dorado` }));
    expect(screen.getByRole("button", { name: "Agregado" })).toBeDisabled();
    expect(screen.getByText(/1 pieza en 1 renglón/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Quitar ${ANILLO} · Dorado` }));
    expect(screen.queryByRole("button", { name: "Agregado" })).toBeNull();
    expect(screen.getByRole("button", { name: `Agregar ${ANILLO} · Dorado` })).toBeEnabled();
    // Sin renglones, el bloque de captura no ocupa espacio.
    expect(screen.queryByText("Piezas para surtir")).toBeNull();
  });

  it("precios: la variante que comparte el del diseño lo trae sugerido; la de mapa propio sin el nivel lo pide", () => {
    withEmptyPoint();
    openDialog();
    // Renglones disponibles: Dorado, Plateado, Reloj B, Oro (comparte el del
    // diseño) y Perla (mapa propio SIN el nivel del punto).
    const priceOf = (name: string) =>
      (screen.getByLabelText(`Precio de etiqueta de ${name}`) as HTMLInputElement).value;
    expect(priceOf(`${ANILLO} · Dorado`)).toBe("160");
    expect(priceOf(`${ANILLO} · Plateado`)).toBe("165");
    expect(priceOf("Reloj B")).toBe("120");
    expect(priceOf("Arete C · Oro")).toBe("100");
    expect(priceOf("Arete C · Perla")).toBe("");
    expect(screen.getAllByText(/Sin precio sugerido en este nivel/).length).toBe(1);
    // Sin precio válido no se agrega: el renglón explica qué falta.
    fireEvent.change(screen.getByLabelText("Cantidad de Arete C · Perla"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Arete C · Perla" }));
    expect(screen.getByText("Captura el precio de etiqueta.")).toBeTruthy();
    expect(screen.queryByText(/renglones/)).toBeNull();
  });

  it("un renglón inválido detiene el lote completo: el callable recibe cero llamadas hasta corregir", async () => {
    withEmptyPoint();
    mocks.stockPoint.mockResolvedValue({ stocked: true, entryCount: 2, units: 3 });
    openDialog();
    fireEvent.change(screen.getByLabelText(`Cantidad de ${ANILLO} · Dorado`), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: `Agregar ${ANILLO} · Dorado` }));
    fireEvent.change(screen.getByLabelText(`Cantidad de ${ANILLO} · Plateado`), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: `Agregar ${ANILLO} · Plateado` }));
    // Edita la captura: más piezas que la existencia del almacén.
    fireEvent.change(screen.getByLabelText(`Cantidad a surtir de ${ANILLO} · Plateado`), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    expect(await screen.findByText("Sólo hay 8 en almacén.")).toBeTruthy();
    expect(mocks.stockPoint).not.toHaveBeenCalled();
    // Precio vacío: el mismo freno para todo el lote.
    fireEvent.change(screen.getByLabelText(`Precio de etiqueta a surtir de ${ANILLO} · Dorado`), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    expect(await screen.findByText("Captura el precio de etiqueta.")).toBeTruthy();
    expect(mocks.stockPoint).not.toHaveBeenCalled();
    // Corrige y la confirmación sale completa.
    fireEvent.change(screen.getByLabelText(`Cantidad a surtir de ${ANILLO} · Plateado`), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(`Precio de etiqueta a surtir de ${ANILLO} · Dorado`), { target: { value: "169.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Surtir piezas" }));
    await screen.findByText(/Surtido: 3 piezas/i);
    expect(mocks.stockPoint).toHaveBeenCalledTimes(1);
    expect(mocks.stockPoint.mock.calls[0][0].lines).toHaveLength(2);
  });

  it("cancelar descarta la captura: al reabrir no aparece nada de otra sesión", () => {
    withEmptyPoint();
    openDialog();
    fireEvent.change(screen.getByLabelText(`Cantidad de ${ANILLO} · Dorado`), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: `Agregar ${ANILLO} · Dorado` }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Piezas para surtir")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Surtir del almacén" }));
    expect(screen.queryByText(/renglones/)).toBeNull();
    expect(mocks.stockPoint).not.toHaveBeenCalled();
  });
});

// #583 — corregir el último corte de un punto sin perder la captura: la
// ficha identifica el corte concreto (fecha, estado, importe) y ofrece la
// corrección DESDE el registro, con la captura original recuperada, el
// efecto visible en piezas e importe, motivo y confirmación única.
describe("#583 corregir el corte desde su registro en la ficha", () => {
  const POINT = { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, commissionRate: 0.2, createdAt: NOW, updatedAt: NOW };
  const CORTE_3P = {
    id: "corte_3p",
    storeId: "store_olivia",
    pointId: "store_olivia__mostrador",
    kind: "corte" as const,
    status: "pendiente_de_cobro" as const,
    effectiveDate: "2026-11-26",
    commissionRate: 0.2,
    confirmedBy: "u1",
    confirmedAt: "2026-11-26T12:00:00.000Z",
    lines: [{ productId: "p2", variantId: "v-cafe", markedPriceCents: 68000, soldQty: 3 }],
    writeOffs: [],
    saleAllocations: [{ lineIndex: 0, allocations: [{ entryId: "pe-cafe", quantity: 3 }] }],
    writeOffAllocations: [],
    totals: { grossSaleCents: 204000, commissionCents: 40800, netCents: 163200, soldCostCents: 90000, pendingCostUnits: 0, writeOffCostCents: 0, writeOffPendingUnits: 0, resultCents: 73200, remainingUnits: 8 },
  };

  function withCorteOf3() {
    state.points = [POINT];
    state.pointEntries = [
      { id: "pe-cafe", storeId: "store_olivia", pointId: POINT.id, productId: "p2", variantId: "v-cafe", productName: "Cartera de piel", variantColor: "Café", entryDate: "2026-11-20", quantity: 10, consumedQty: 3, markedPriceCents: 68000, unitCostCents: 30000, createdAt: NOW, updatedAt: NOW } as PointEntry,
      { id: "pe-negra", storeId: "store_olivia", pointId: POINT.id, productId: "p2", variantId: "v-negra", productName: "Cartera de piel", variantColor: "Negra", entryDate: "2026-11-20", quantity: 4, consumedQty: 0, markedPriceCents: 68000, unitCostCents: 30000, createdAt: NOW, updatedAt: NOW } as PointEntry,
    ];
    state.pointOperations = [CORTE_3P];
  }

  it("la ficha lista el corte concreto con fecha, estado e importe y ofrece corregirlo desde el registro", () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.getByText("Cortes del punto")).toBeTruthy();
    expect(screen.getByText(/26 nov.*2026/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Corregir corte" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anular corte" })).toBeTruthy();
  });

  it("recupera la captura original: cantidad por variante, disponibilidad restaurada y resumen original", () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    // La fila de Café vuelve a ver las 10 piezas (7 actuales + 3 del corte).
    expect(screen.getByText(/10 disponibles/)).toBeTruthy();
    expect(screen.getByText(/4 disponibles/)).toBeTruthy();
    const vendidas = screen.getAllByLabelText("Vendidas");
    expect((vendidas[0] as HTMLInputElement).value).toBe("3");
    expect((vendidas[1] as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Original: 3 piezas/)).toBeTruthy();
    // Al abrir, original y corregido coinciden: el efecto se revisa al editar.
    expect(screen.getAllByText(/neto \$1,632/).length).toBe(2);
    // Sin motivo no hay confirmación posible.
    const confirm = screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0];
    expect(confirm).toBeDisabled();
  });

  it("corregir 3 → 2: revisa el efecto (piezas e importe) y envía las líneas exactas con fecha y comisión del original", async () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    fireEvent.change(screen.getAllByLabelText("Vendidas")[0], { target: { value: "2" } });
    // Efecto visible antes de confirmar: neto nuevo vs original.
    expect(screen.getByText(/Corregido: 2 piezas/)).toBeTruthy();
    expect(screen.getByText(/neto \$1,088/)).toBeTruthy();
    expect(screen.getByText(/Quedan 12 piezas/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Eran 2, no 3" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0]);
    await screen.findByText(/Corte corregido/i);
    expect(mocks.correctPointCut).toHaveBeenCalledTimes(1);
    expect(mocks.correctPointCut.mock.calls[0][0]).toMatchObject({
      storeId: "store_olivia",
      pointId: POINT.id,
      corteId: "corte_3p",
      lines: [{ productId: "p2", variantId: "v-cafe", markedPriceCents: 68000, soldQty: 2 }],
      writeOffs: [],
    });
    expect(mocks.correctPointCut.mock.calls[0][0].intentId).toBeTruthy();
    // La fecha y la comisión viven en el original: el cliente no las re-envía.
    expect(mocks.correctPointCut.mock.calls[0][0].effectiveDate).toBeUndefined();
    expect(mocks.correctPointCut.mock.calls[0][0].commissionRate).toBeUndefined();
  });

  it("corregir la variante: mover una pieza de Café a Negra viaja en las líneas", async () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    fireEvent.change(screen.getAllByLabelText("Vendidas")[0], { target: { value: "2" } });
    fireEvent.change(screen.getAllByLabelText("Vendidas")[1], { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Una era Negra" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0]);
    await screen.findByText(/Corte corregido/i);
    expect(mocks.correctPointCut.mock.calls[0][0].lines).toEqual([
      { productId: "p2", variantId: "v-cafe", markedPriceCents: 68000, soldQty: 2 },
      { productId: "p2", variantId: "v-negra", markedPriceCents: 68000, soldQty: 1 },
    ]);
  });

  it("una baja sigue distinguiéndose de una venta dentro de la corrección", async () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    fireEvent.change(screen.getAllByLabelText("Vendidas")[0], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar baja" }));
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Dañada en mostrador" } });
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Ajuste de corte" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0]);
    await screen.findByText(/Corte corregido/i);
    expect(mocks.correctPointCut.mock.calls[0][0].writeOffs).toEqual([
      { productId: "p2", variantId: "v-cafe", markedPriceCents: 68000, qty: 1, reason: "Dañada en mostrador" },
    ]);
  });

  it("movimiento posterior: ni corregir ni anular se ofrecen y el motivo es comprobable (el caso rojo de la interfaz)", () => {
    withCorteOf3();
    state.pointOperations = [
      CORTE_3P,
      { ...CORTE_3P, id: "corte_4p", status: "cobrado" as const, confirmedAt: "2026-11-27T09:00:00.000Z", effectiveDate: "2026-11-27", lines: [], saleAllocations: [] },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.queryByRole("button", { name: "Corregir corte" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Anular corte" })).toBeNull();
    expect(screen.getByText(/movimientos posteriores/i)).toBeTruthy();
    // #583 code review (Mayor): el cobro es una vía independiente — un corte
    // por cobrar CON movimientos posteriores conserva su ruta de cobro.
    expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeTruthy();
  });

  it("un corte por cobrar de un mes cerrado conserva su ruta de cobro aunque no se pueda corregir", async () => {
    withCorteOf3();
    mocks.closes = [{ period: "2026-11" }];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    await screen.findByText(/cierre autorizado/i);
    expect(screen.queryByRole("button", { name: "Corregir corte" })).toBeNull();
    expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeTruthy();
  });

  it("corte cobrado: informa el motivo; un punto sin cortes no muestra la sección", () => {
    withCorteOf3();
    state.pointOperations = [{ ...CORTE_3P, status: "cobrado" as const }];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.queryByRole("button", { name: "Corregir corte" })).toBeNull();
    expect(screen.getByText(/cobro registrado/i)).toBeTruthy();
    // Sin cortes: la sección no existe (no es lo mismo «sin cortes» que «no elegible»).
    state.pointOperations = [];
    cleanup();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.queryByText("Cortes del punto")).toBeNull();
  });

  it("el motivo de la corrección queda consultable en la fila del corte que reemplazó", () => {
    withCorteOf3();
    state.pointOperations = [
      { ...CORTE_3P, status: "anulado" as const, replacedByCorteId: "corte_corr_m1" },
      { id: "corr_m1", storeId: "store_olivia", pointId: POINT.id, kind: "correccion" as const, intentionId: "i", corteId: "corte_3p", newCorteId: "corte_corr_m1", motive: "Eran 2 piezas, no 3", confirmedBy: "u1", confirmedAt: "2026-11-26T13:00:00.000Z" },
      { ...CORTE_3P, id: "corte_corr_m1", status: "pendiente_de_cobro" as const, replacesCorteId: "corte_3p", confirmedAt: "2026-11-26T13:00:00.000Z" },
    ];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    expect(screen.getByText(/Este corte ya está anulado\. Motivo: Eran 2 piezas, no 3/)).toBeTruthy();
  });

  it("doble envío: mientras confirma el botón se deshabilita y no hay segunda llamada", async () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    fireEvent.change(screen.getAllByLabelText("Vendidas")[0], { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Eran 2" } });
    let release: (value: unknown) => void = () => {};
    mocks.correctPointCut.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const confirm = screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0];
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    release({ corrected: true });
    await screen.findByText(/Corte corregido/i);
    expect(mocks.correctPointCut).toHaveBeenCalledTimes(1);
  });

  it("reintento tras respuesta perdida: MISMO intentId, captura intacta y «ya aplicada» cierra sin duplicar", async () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    fireEvent.change(screen.getAllByLabelText("Vendidas")[0], { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Eran 2" } });
    mocks.correctPointCut.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.click(screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0]);
    await screen.findByText(/Network request failed/i);
    // La captura sobrevive al fallo: nada se recaptura.
    expect((screen.getAllByLabelText("Vendidas")[0] as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Motivo de la corrección") as HTMLInputElement).value).toBe("Eran 2");
    mocks.correctPointCut.mockResolvedValueOnce({ corrected: false, alreadyApplied: true, corteId: "corte_corr_n1" });
    fireEvent.click(screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0]);
    await screen.findByText(/ya estaba aplicada/i);
    expect(mocks.correctPointCut).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.correctPointCut.mock.calls;
    expect(second[0].intentId).toBe(first[0].intentId);
    expect(first[0].intentId).toBeTruthy();
  });

  it("el rechazo del servidor conserva la captura y explica el impedimento", async () => {
    withCorteOf3();
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Corregir corte" }));
    fireEvent.change(screen.getAllByLabelText("Vendidas")[0], { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Eran 2" } });
    mocks.correctPointCut.mockRejectedValueOnce(new Error("Hay movimientos posteriores en este punto."));
    fireEvent.click(screen.getAllByRole("button", { name: "Corregir corte" }).slice(-1)[0]);
    await screen.findByText(/movimientos posteriores en este punto/i);
    // El diálogo sigue abierto con la captura: el fallo no anonada nada.
    expect((screen.getAllByLabelText("Vendidas")[0] as HTMLInputElement).value).toBe("2");
  });
});
