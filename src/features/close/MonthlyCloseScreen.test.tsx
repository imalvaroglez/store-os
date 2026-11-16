// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { MonthlyCloseScreen } from "./MonthlyCloseScreen";
import type { LooseExpense, Order, OrderPayment } from "../../types";

// #129 stage: the read-only preview renders the monthly close from the store's
// own data — the $500/$150/$350 contract case must read correctly on screen.

const mocks = vi.hoisted(() => ({
  state: {
    orders: [] as Order[],
    expenses: [] as LooseExpense[],
  },
  activeStore: { id: "s1", name: "Tienda", type: "inventory_tiered" },
  loadOrderPaymentsDocs: vi.fn(),
  draftOwnerId: undefined as string | undefined,
  loadLatestClose: vi.fn(async () => null as unknown),
  authorizeMonthlyClose: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ state: mocks.state, activeStore: mocks.activeStore, stateStatus: "ready", draftOwnerId: mocks.draftOwnerId ?? "u_owner" }) }));
vi.mock("../../app/firebase/firestoreData", () => ({
  loadOrderPaymentsDocs: mocks.loadOrderPaymentsDocs,
  loadLatestClose: mocks.loadLatestClose,
  authorizeMonthlyClose: mocks.authorizeMonthlyClose,
}));

// The CURRENT CDMX month is dynamic; fixtures are built relative to it so the
// suite never breaks at a month boundary. Contract case: delivery THIS month
// ($500 / cost $200), anticipo LAST month ($150), saldo THIS month ($350).
function currentMonthIso(day: number, hourUtc = 12): string {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).format(new Date());
  const [year, month] = now.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;
}

const contractOrder: Order = {
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500, cost: 200 }],
  deposit: 0,
  orderStatus: "delivered",
  paymentStatus: "paid",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deliveries: [{
    id: "d1", orderId: "o1", storeId: "s1",
    deliveredAt: currentMonthIso(10), recordedAt: currentMonthIso(10), by: "u1",
    lines: [{ productId: "p1", quantity: 1 }],
  }],
};

const payments: Record<string, OrderPayment[]> = {
  o1: [
    { id: "pay_now", orderId: "o1", storeId: "s1", method: "cash", kind: "payment", amount: 350, date: currentMonthIso(20).slice(0, 10), createdAt: "", createdBy: "u1" },
  ],
};

beforeEach(() => {
  mocks.state.orders = [contractOrder];
  mocks.state.expenses = [];
  mocks.loadOrderPaymentsDocs.mockReset().mockResolvedValue(payments);
  mocks.loadLatestClose.mockReset().mockResolvedValue(null);
  mocks.authorizeMonthlyClose.mockReset().mockResolvedValue({ id: "x", version: 1 });
});

describe("MonthlyCloseScreen (vista previa, solo lectura)", () => {
  it("muestra el cierre del mes vigente con el caso del contrato", async () => {
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(mocks.loadOrderPaymentsDocs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Ventas de productos entregados")).toBeTruthy());
    // Venta $500 / costo −$200 (con signo, contrato #455) / margen $300 / cobros $350.
    expect(screen.getByText("$500.00")).toBeTruthy();
    expect(screen.getByText("−$200.00")).toBeTruthy();
    // Margen y resultado comparten $300 (gastos 0): héroe + 2 filas de fórmula.
    expect(screen.getAllByText("$300.00").length).toBe(3);
    expect(screen.getAllByText("$350.00").length).toBeGreaterThanOrEqual(1); // cifra + grupo de origen
    // Cobros como sección independiente con su chip y su párrafo siempre visible.
    expect(screen.getByText("Por fecha de cobro")).toBeTruthy();
    expect(screen.getByText(/No representa una ganancia adicional/)).toBeTruthy();
    // El héroe del resultado lleva su aviso de no autorización.
    expect(screen.getByText("GANANCIA OPERATIVA ESTIMADA")).toBeTruthy();
    expect(screen.getByText(/todavía no está autorizado para reparto/)).toBeTruthy();
    expect(screen.getAllByText(/Vista preliminar/).length).toBeGreaterThanOrEqual(1);
  });

  it("si falla la carga de cobros, lo explica y marca los cobros como no disponibles (nunca $0 engañoso)", async () => {
    mocks.loadOrderPaymentsDocs.mockReset().mockRejectedValue(new Error("offline"));
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    expect(await screen.findByText(/No se pudieron cargar los cobros/i)).toBeTruthy();
    // La sección de cobros dice «no disponibles» (no un $0.00 engañoso).
    const cobrosCard = screen.getByText(/Dinero recibido durante/).closest("div[class*='rounded']") ?? screen.getByText(/Dinero recibido durante/).parentElement;
    expect(cobrosCard?.textContent).toContain("no disponibles");
    // Las ventas no dependen de los cobros: siguen mostrándose.
    expect(screen.getByText("$500.00")).toBeTruthy();
  });

  it("navega al mes anterior y muestra el anticipo cobrado allí", async () => {
    // Anticipo del mes anterior + entrega de este mes (el contrato).
    const prevIso = currentMonthIso(1);
    const prev = new Date(new Date(prevIso).getTime() - 15 * 24 * 60 * 60 * 1000);
    const prevDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(prev);
    mocks.loadOrderPaymentsDocs.mockResolvedValue({
      o1: [
        { id: "pay_prev", orderId: "o1", storeId: "s1", method: "cash", kind: "payment", amount: 150, date: prevDate, createdAt: "", createdBy: "u1" },
      ],
    });
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("Ventas de productos entregados")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(screen.getAllByText("$150.00").length).toBeGreaterThanOrEqual(1)); // cobros del mes anterior (cifra + grupo)
    expect(screen.queryByText("$500.00")).toBeNull(); // sin ventas allá
  });

  it("la cobertura incompleta queda a la vista y avisa que no habilita cierre", async () => {
    // Dos huecos: un entregado legado sin evidencia y una entrega con fecha
    // cuya línea no conoce el costo.
    mocks.state.orders = [
      { ...contractOrder, id: "o_legacy", deliveries: undefined },
      { ...contractOrder, id: "o_nocost", items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500 }] },
    ];
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Hay información pendiente de revisar/i)).toBeTruthy());
    // Agrupados por causa con conteo — no feeds de identificadores.
    expect(screen.getByText(/1 pedido entregado sin fecha verificable/)).toBeTruthy();
    expect(screen.getByText(/No podemos determinar a qué mes pertenecen/)).toBeTruthy();
    expect(screen.getByText(/producto vendido sin costo conocido/)).toBeTruthy();
    expect(screen.getByText(/Puede afectar la utilidad/)).toBeTruthy();
    expect(screen.getByText("En revisión")).toBeTruthy();
    // #457: cada causa abre su COLA en la misma tarea (botón «Revisar»).
    const revisarPedidos = screen.getAllByRole("button", { name: "Revisar" })[0];
    fireEvent.click(revisarPedidos);
    expect(screen.getByText("Pedidos entregados sin fecha")).toBeTruthy();
    expect(screen.getByText(/por revisar/)).toBeTruthy();
    expect(screen.getByText(/1 pedido entregado sin fecha verificable/)).toBeTruthy();
  });
});

describe("#129 r2 — devoluciones de revisión", () => {
  const NOW = "2026-11-14T10:00:00.000Z";
  const baseOrder = (id: string, extra: Partial<Order> = {}): Order => ({
    id, storeId: "s1", customerId: "c1",
    items: [{ lineId: "L1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 300, subtotal: 300, cost: 100 }],
    deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
    createdAt: NOW, updatedAt: NOW, ...extra,
  });
  const paidBeforeDelivery = baseOrder("o_paid", { paymentsReceivedCents: 20000, paymentStatus: "partial" });
  const pay = (id: string, amount: number) => ({ id, orderId: "o_paid", storeId: "s1", date: "2026-11-05", method: "cash", kind: "payment", amount, createdAt: NOW, createdBy: "u1" });

  it("un abono registrado antes de la entrega (sin entregas ni anticipo) SÍ entra en Cobros del mes", async () => {
    mocks.state.orders = [paidBeforeDelivery];
    mocks.loadOrderPaymentsDocs.mockClear().mockResolvedValue({ o_paid: [pay("pay_before", 200)] });
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Dinero recibido durante/)).toBeTruthy());
    expect(mocks.loadOrderPaymentsDocs).toHaveBeenCalledWith(["o_paid"]);
    await waitFor(() => expect(screen.getAllByText("$200.00").length).toBeGreaterThanOrEqual(1));
  });

  it("fecha de entrega corrupta degrada la fila sin tumbar la vista (monto NaN se coerce vía orderItems)", async () => {
    const bad = baseOrder("o_bad", {
      orderStatus: "delivered",
      items: [{ lineId: "L1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: Number.NaN, subtotal: 0 }],
      deliveries: [{ id: "d1", orderId: "o_bad", storeId: "s1", deliveredAt: "fecha-rota", recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
      paymentsReceivedCents: 15000,
    });
    mocks.state.orders = [bad];
    mocks.loadOrderPaymentsDocs.mockClear().mockResolvedValue({});
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("Ventas de productos entregados")).toBeTruthy());
    // La vista sigue viva; la causa dañada queda agrupada y contada.
    expect(screen.getByText(/1 pedido con datos no interpretables/)).toBeTruthy();
    expect(screen.getByText(/impide leer este pedido/)).toBeTruthy();
  });

  it("pieza entregada cuya línea ya no existe queda VISIBLE en cobertura", async () => {
    const staleLine = baseOrder("o_stale", {
      orderStatus: "delivered",
      items: [],
      deliveries: [{ id: "d1", orderId: "o_stale", storeId: "s1", deliveredAt: "2026-11-05", recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
    });
    mocks.state.orders = [staleLine];
    mocks.loadOrderPaymentsDocs.mockClear().mockResolvedValue({});
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(/Hay información pendiente de revisar/i)).toBeTruthy());
    // La pieza queda a la vista como fila agrupada con su conteo.
    expect(screen.getByText(/1 pieza entregada que ya no está en el pedido/)).toBeTruthy();
    expect(screen.getByText(/La evidencia de entrega se conserva/)).toBeTruthy();
  });
});

describe("#455 estados del contrato", () => {
  it("resultado negativo: el héroe dice PÉRDIDA OPERATIVA ESTIMADA, sin verde", async () => {
    // Venta $300 con costo $500 → resultado −$200.
    const losing: Order = {
      ...contractOrder,
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 300, subtotal: 300, cost: 500 }],
    };
    mocks.state.orders = [losing];
    mocks.loadOrderPaymentsDocs.mockClear().mockResolvedValue({});
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("PÉRDIDA OPERATIVA ESTIMADA")).toBeTruthy());
    expect(screen.getByText("−$200.00")).toBeTruthy();
  });

  it("sin pendientes: estado sobrio, sin contenedor de advertencia vacío", async () => {
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("Ventas de productos entregados")).toBeTruthy());
    expect(screen.getByText(/Sin pendientes detectados para este periodo/)).toBeTruthy();
    expect(screen.queryByText(/Hay información pendiente/)).toBeNull();
  });
});

describe("#456 — drilldowns trazables", () => {
  it("clic en Ventas abre «¿De dónde salen estas $X?» con la fila trazable y la suma que cuadra", async () => {
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("Ventas de productos entregados")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Ver de dónde salen estos $500.00" }));
    expect(screen.getByText(/¿De dónde salen estas \$500\.00\?/)).toBeTruthy();
    expect(screen.getByText("#O1")).toBeTruthy();
    expect(screen.getByText(/Venta entregada · Aro/)).toBeTruthy();
    expect(screen.getByText(/1 movimiento incluido/)).toBeTruthy();
    expect(screen.getByText(/cuadra con la cifra del panel/)).toBeTruthy();
    // Búsqueda por folio encuentra la fila; por texto ajeno la vacía.
    fireEvent.change(screen.getByLabelText(/Buscar por folio o concepto/), { target: { value: "#O1" } });
    expect(screen.getByText("#O1")).toBeTruthy();
    expect(screen.getByText(/Venta entregada · Aro/)).toBeTruthy();
  });

  it("clic en Cobros abre el detalle con grupos de origen y los excluidos por verificar", async () => {
    // Un cobro sin fecha: queda fuera del total y listado con causa.
    mocks.loadOrderPaymentsDocs.mockReset().mockResolvedValue({
      ...payments,
      o1: [...payments.o1, { id: "no_date", orderId: "o1", storeId: "s1", method: "cash", kind: "payment", amount: 90, date: "", createdAt: "", createdBy: "u1" }],
    });
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Dinero recibido durante/ })).toBeTruthy());
    // La tarjeta ya muestra los grupos de origen que reconcilian.
    expect(screen.getByText(/Liquidaciones del mes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dinero recibido durante/ }));
    expect(screen.getByText(/¿De dónde salen estos \$350\.00\?/)).toBeTruthy();
    expect(screen.getByText(/1 por verificar/)).toBeTruthy();
    expect(screen.getByText(/Fuera del total/)).toBeTruthy();
    expect(screen.getByText(/sin fecha verificable/)).toBeTruthy();
  });

  it("costo faltante: el héroe se etiqueta «Estimación incompleta»", async () => {
    mocks.state.orders = [{
      ...contractOrder,
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500 }],
    }];
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("Estimación incompleta")).toBeTruthy());
  });

  it("cientos de movimientos: carga progresiva y totales siempre visibles", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `o${i}`, storeId: "s1", customerId: "c1",
      items: [{ lineId: `l${i}`, productId: "p1", productName: `Pieza ${i}`, quantity: 1, unitPrice: 100, subtotal: 100, cost: 40 }],
      deposit: 0, orderStatus: "delivered", paymentStatus: "paid", createdAt: "", updatedAt: "",
      deliveries: [{ id: `d${i}`, orderId: `o${i}`, storeId: "s1", deliveredAt: currentMonthIso(10 + (i % 10)), recordedAt: "", by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
    } as unknown as Order));
    mocks.state.orders = many;
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    const ventasRow = await screen.findByRole("button", { name: "Ver de dónde salen estos $12,000.00" });
    fireEvent.click(ventasRow);
    expect(screen.getByText(/Mostrar más/)).toBeTruthy();
    // El total reconciliado está visible sin abrir el resto.
    expect(screen.getByText(/120 movimientos incluidos/)).toBeTruthy();
    expect(screen.getByText("Suma del detalle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mostrar más/ }));
    expect(screen.queryByText(/Mostrar más/)).toBeNull(); // todo cargado
  });
});

describe("#457 — colas de revisión", () => {
  const withGaps = () => {
    mocks.state.orders = [
      { ...contractOrder, id: "order_d1", deliveries: undefined, orderStatus: "delivered" },
      { ...contractOrder, id: "order_d2", deliveries: undefined, orderStatus: "delivered" },
      { ...contractOrder, id: "order_nc", items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500 }] },
    ];
    mocks.loadOrderPaymentsDocs.mockReset().mockResolvedValue({
      order_nc: [{ id: "nd", orderId: "order_nc", storeId: "s1", date: "", method: "cash", kind: "payment", amount: 170, createdAt: "", createdBy: "u1" }],
    });
  };

  it("la cola de pedidos sin fecha: conteo honesto («por determinar», no un 0 falso), búsqueda y acción por fila", async () => {
    withGaps();
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await screen.findByText(/Hay información pendiente de revisar/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Revisar" })[0]);
    expect(screen.getByText("Pedidos entregados sin fecha")).toBeTruthy();
    expect(screen.getByText(/2 por revisar/)).toBeTruthy();
    expect(screen.getByText(/2 con periodo por determinar/)).toBeTruthy();
    expect(screen.getByText(/desconocido, no «fuera del mes»/)).toBeTruthy();
    // Cada fila habla humano y lleva su acción al origen.
    expect(screen.getAllByText(/Ver pedido/).length).toBeGreaterThanOrEqual(2);
    fireEvent.change(screen.getByLabelText(/Buscar por folio, clienta o producto/), { target: { value: "zzz-ajeno" } });
    expect(screen.getByText(/Sin registros con esos criterios/)).toBeTruthy();
  });

  it("la cola de cobros sin fecha ahora SÍ se abre (antes quedaba informativa)", async () => {
    withGaps();
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await screen.findByText(/Hay información pendiente de revisar/i);
    // La fila de cobros es la segunda causa con botón Revisar.
    fireEvent.click(screen.getAllByRole("button", { name: "Revisar" })[1]);
    expect(screen.getByText("Cobros sin fecha")).toBeTruthy();
    expect(screen.getByText(/Cobro sin fecha verificable/)).toBeTruthy();
    expect(screen.getAllByText(/\$170\.00/).length).toBeGreaterThanOrEqual(1); // fila de la cola
  });

  it("la cola de costo muestra producto y piezas, con acción «Ver producto»", async () => {
    withGaps();
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await screen.findByText(/Hay información pendiente de revisar/i);
    fireEvent.click(screen.getAllByRole("button", { name: "Revisar" })[2]);
    expect(screen.getByText("Productos sin costo")).toBeTruthy();
    expect(screen.getByText(/Aro ×1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver producto" })).toBeTruthy();
  });
});

describe("#458 — cierre oficial", () => {
  it("mes en curso: «El mes aún no termina» y SIN botón de cerrar aunque todo cuadre", async () => {
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByText("Revisión antes de cerrar")).toBeTruthy());
    expect(screen.getByText(/El mes aún no termina/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cerrar / })).toBeNull();
  });

  it("mes pasado con pendientes: razones humanas con su «Revisar …», sin CTA", async () => {
    const gaps = { ...contractOrder, id: "og", deliveries: undefined, orderStatus: "delivered" } as unknown as Order;
    mocks.state.orders = [gaps];
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(screen.getByText(/Faltan fechas de entrega verificables/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Revisar pedidos/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cerrar /i })).toBeNull();
  });

  it("mes pasado íntegro y dueña: CTA → diálogo con resumen en centavos → confirmación idempotente y sello", async () => {
    mocks.draftOwnerId = "u_owner";
    (mocks.activeStore as { ownerUid?: string }).ownerUid = "u_owner";
    // Dueña y mes anterior limpio: montar directo en el mes anterior.
    window.history.replaceState({}, "", "/");
    cleanup();
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await screen.findByText("Revisión antes de cerrar");
    // El mes actual está en curso: usar el botón Cerrar del mes anterior no
    // aplica aquí; validamos el flujo en el mes anterior navegando.
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Cerrar / })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Cerrar / }));
    expect(screen.getByText(/Confirmar cierre de/)).toBeTruthy();
    expect(screen.getByText(/fija una versión inmutable del periodo a tu nombre/)).toBeTruthy();
    // Tras autorizar, la recarga del periodo devuelve el snapshot sellado.
    const sealedSnapshot = {
      id: "s1__oct__v1", storeId: "s1", period: "2026-10", version: 1,
      authorizedByUid: "u_owner", authorizedAt: "2026-12-01T10:00:00.000Z",
      totals: { operatingResultCents: 0 },
    };
    mocks.loadLatestClose.mockResolvedValue(sealedSnapshot);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cierre" }));
    await waitFor(() => expect(mocks.authorizeMonthlyClose).toHaveBeenCalledTimes(1));
    const snapshot = mocks.authorizeMonthlyClose.mock.calls[0][0];
    expect(snapshot.version).toBe(1);
    expect(snapshot.authorizedByUid).toBe("u_owner");
    expect(typeof snapshot.totals.operatingResultCents).toBe("number"); // totales del periodo (0 es válido sin ventas)
    // Sello de versión autorizada.
    await waitFor(() => expect(screen.getByText(/versión 1/)).toBeTruthy());
  });

  it("no es la dueña: puede consultar, sin CTA y con el texto que lo explica", async () => {
    mocks.draftOwnerId = "u_someone_else";
    cleanup();
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await screen.findByText("Revisión antes de cerrar");
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(screen.getByText(/Solo la dueña de la tienda puede confirmar/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Cerrar / })).toBeNull();
  });

  it("mes YA cerrado: sello con versión y enlace a reparto; sin CTA doble", async () => {
    mocks.draftOwnerId = "u_owner";
    mocks.loadLatestClose.mockReset().mockResolvedValue({
      id: "s1__prev__v1", storeId: "s1", period: "2026-10", version: 1,
      authorizedByUid: "u_owner", authorizedAt: "2026-11-02T10:00:00.000Z",
      totals: { operatingResultCents: 25000 },
    });
    cleanup();
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(screen.getByText(/Cerrado/)).toBeTruthy());
    expect(screen.getByText(/versión 1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ir a reparto de utilidades/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Cerrar / })).toBeNull();
  });
});
