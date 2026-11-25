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
  registerPointCut: vi.fn(),
  registerPointCutPayment: vi.fn(),
  stockPoint: vi.fn(),
  withdrawFromPoint: vi.fn(),
  annulPointCut: vi.fn(),
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
      stockPoint: mocks.stockPoint,
      withdrawFromPoint: mocks.withdrawFromPoint,
      annulPointCut: mocks.annulPointCut,
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
  mocks.stockPoint.mockReset();
  mocks.stockPoint.mockResolvedValue({ stocked: true, entryCount: 1, units: 2 });
  mocks.withdrawFromPoint.mockReset();
  mocks.withdrawFromPoint.mockResolvedValue({ withdrawn: true, units: 1 });
  mocks.annulPointCut.mockReset();
  mocks.annulPointCut.mockResolvedValue({ registered: true });
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
    expect(screen.getByText("Cortes por cobrar")).toBeTruthy();
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
    // El perfume del almacén (6 disponibles, Regular $950) aparece con su precio sugerido.
    expect(screen.getByText(/4 en almacén/)).toBeTruthy();
    const piezas = screen.getAllByLabelText("Piezas");
    fireEvent.change(piezas[0], { target: { value: "2" } });
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
    // Búsqueda 1: el perfume; captura 2 piezas.
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Perfume" } });
    fireEvent.change(screen.getAllByLabelText("Piezas")[0], { target: { value: "2" } });
    // Búsqueda 2: la cartera; captura 1 pieza. La búsqueda anterior sigue
    // filtrando lo visible, pero la captura ya hecha no se pierde.
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "Cartera" } });
    fireEvent.change(screen.getAllByLabelText("Piezas")[0], { target: { value: "1" } });
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

  it("mes con cierre autorizado: no hay formulario, dirige a la revisión de ajustes", async () => {
    withCorte();
    mocks.closes = [{ period: "2026-11" }];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Anular corte" }));
    await screen.findByText(/cierre autorizado/i);
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

  it("surtir: el reintento lleva el MISMO intentId", async () => {
    state.points = [
      { id: "store_olivia__mostrador", storeId: "store_olivia", name: "Mostrador centro", active: true, priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW },
    ];
    state.pointEntries = [];
    mount();
    fireEvent.click(screen.getByText("Mostrador centro"));
    fireEvent.click(screen.getByRole("button", { name: "Surtir del almacén" }));
    fireEvent.change(screen.getAllByLabelText("Piezas")[0], { target: { value: "3" } });
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
