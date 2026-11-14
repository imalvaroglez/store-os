// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => ({ state: mocks.state, activeStore: mocks.activeStore }) }));
vi.mock("../../app/firebase/firestoreData", () => ({ loadOrderPaymentsDocs: mocks.loadOrderPaymentsDocs }));

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
});

describe("MonthlyCloseScreen (vista previa, solo lectura)", () => {
  it("muestra el cierre del mes vigente con el caso del contrato", async () => {
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    await waitFor(() => expect(mocks.loadOrderPaymentsDocs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Ventas (entregas verificadas)")).toBeTruthy());
    // Venta $500 / costo $200 / margen $300 / cobros $350.
    expect(screen.getByText("$500.00")).toBeTruthy();
    expect(screen.getByText("$200.00")).toBeTruthy();
    // Margen bruto y resultado operativo comparten $300 (gastos 0): ambos.
    expect(screen.getAllByText("$300.00").length).toBe(2);
    expect(screen.getByText("$350.00")).toBeTruthy();
    expect(screen.getByText("Cobertura del periodo")).toBeTruthy();
    expect(screen.getByText(/completa/i)).toBeTruthy();
    expect(screen.getByText(/solo lectura/i)).toBeTruthy();
  });

  it("si falla la carga de cobros, lo explica y marca los cobros como no disponibles (nunca $0 engañoso)", async () => {
    mocks.loadOrderPaymentsDocs.mockReset().mockRejectedValue(new Error("offline"));
    render(<ToastProvider><MonthlyCloseScreen /></ToastProvider>);
    expect(await screen.findByText(/No se pudieron cargar los cobros/i)).toBeTruthy();
    // La FILA de cobros dice «no disponibles» (no un $0.00 engañoso).
    const cobrosLabel = screen.getByText("Cobros del mes (fecha real)");
    expect(cobrosLabel.parentElement?.textContent).toContain("no disponibles");
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
    await waitFor(() => expect(screen.getByText("Ventas (entregas verificadas)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(screen.getByText("$150.00")).toBeTruthy()); // cobros del mes anterior
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
    await waitFor(() => expect(screen.getByText(/incompleta — no habilita cierre/i)).toBeTruthy());
    expect(screen.getByText(/Entregados sin fecha verificable/i)).toBeTruthy();
    expect(screen.getByText(/Líneas sin costo conocido/i)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText("Cobros del mes (fecha real)")).toBeTruthy());
    expect(mocks.loadOrderPaymentsDocs).toHaveBeenCalledWith(["o_paid"]);
    await waitFor(() => expect(screen.getByText("$200.00")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText("Ventas (entregas verificadas)")).toBeTruthy());
    // La vista sigue viva; el dato dañado queda identificado, no rompe todo.
    expect(screen.getByText("Datos no interpretables")).toBeTruthy();
    expect(screen.getByText(/#O_BAD/)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText(/incompleta/i)).toBeTruthy());
    // Encabezado de sección + fila del pedido: la pieza está a la vista.
    expect(screen.getAllByText(/ya no existe|sin línea/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/#O_STAL/)).toBeTruthy();
  });
});
