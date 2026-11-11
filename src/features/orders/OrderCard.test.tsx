// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderCard } from "./OrderCard";
import type { Order, OrderPayment, Purchase } from "../../types";

const { state, activeStore, holder } = vi.hoisted(() => ({
  state: { customers: [{ id: "c1", storeId: "s1", name: "Sofía" }], products: [], purchases: [] as Purchase[] },
  activeStore: { name: "Olivia" },
  holder: { upsertOrder: vi.fn(), payments: [] as OrderPayment[] },
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({ upsertOrder: holder.upsertOrder, activeStore, state, payments: holder.payments, loadOrderPayments: async () => {} }),
}));
const order: Order = { id: "o1", storeId: "s1", customerId: "c1", items: [{ productName: "Anillo", quantity: 1, unitPrice: 1.25, subtotal: 1.25 }], deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-01-01", updatedAt: "" };

describe("sharing a saved order", () => {
  it("copies the displayed text without opening the editor", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const edit = vi.fn();
    const rendered = render(<ToastProvider><OrderCard order={order} onEdit={edit} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    expect(edit).not.toHaveBeenCalled();
    const text = screen.getByLabelText("Detalle del pedido") as HTMLTextAreaElement;
    expect(text.value).toContain("Anillo");
    expect(text.value).toContain("*Tienda:* Olivia");
    expect(text.value).toContain("*Total* $1.25");
    fireEvent.click(screen.getByRole("button", { name: "Copiar detalle" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(text.value));
    rendered.unmount();
  });

  it("keeps selectable text when the clipboard is denied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const rendered = render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    fireEvent.click(screen.getByRole("button", { name: "Copiar detalle" }));
    await waitFor(() => expect(screen.getByText(/Selecciona el texto/)).toBeInTheDocument());
    expect((screen.getByLabelText("Detalle del pedido") as HTMLTextAreaElement).value).toContain("Anillo");
    rendered.unmount();
  });
});

describe("installment order card (#165)", () => {
  const planOrder: Order = {
    id: "o2",
    storeId: "s1",
    customerId: "c1",
    items: [{ lineId: "l1", productName: "Caja adviento", quantity: 1, unitPrice: 1800, subtotal: 1800 }],
    deposit: 0,
    orderStatus: "ready",
    paymentStatus: "unpaid",
    createdAt: "2026-11-01",
    updatedAt: "",
    installments: { count: 6, frequency: "monthly", firstDueDate: "2026-11-15", agreedAt: "2026-11-01", agreedBy: "u1" },
  };
  const abono = (id: string, amount: number): OrderPayment => ({
    id, orderId: "o2", storeId: "s1", date: "2026-11-02", method: "cash", kind: "payment",
    amount, createdAt: "2026-11-02T12:00:00.000Z", createdBy: "u1",
  });

  beforeEach(() => {
    holder.payments = [];
    holder.upsertOrder.mockReset();
  });

  it("shows the plan badge, Abonar instead of the legacy Cobrar, and no auto-delivery", () => {
    const rendered = render(
      <ToastProvider>
        <OrderCard order={planOrder} onEdit={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByText("Pagos por partes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Abonar" })).toBeInTheDocument();
    // Con saldo, la entrega no se ofrece como acción disponible.
    expect(screen.getByText(/entrega se habilita al liquidar/i)).toBeInTheDocument();
    rendered.unmount();
  });

  it("shows recibido/saldo from the order doc accumulator — correct right after a reload (#168 F3)", () => {
    // Session has NO payment records loaded (fresh reload); the money truth
    // lives on the order document and the card must show it.
    const rendered = render(
      <ToastProvider>
        <OrderCard order={{ ...planOrder, paymentsReceivedCents: 60000 }} onEdit={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByText("Recibido")).toBeInTheDocument();
    expect(screen.getByText("$600.00")).toBeInTheDocument();
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    rendered.unmount();
  });

  it("session records alone no longer drive the card numbers", () => {
    holder.payments = [abono("p1", 100), abono("p2", 500)];
    const rendered = render(
      <ToastProvider>
        <OrderCard order={planOrder} onEdit={() => {}} />
      </ToastProvider>
    );
    // Without the doc accumulator the card shows $0 received — records only
    // surface in the Cobros sheet, never as a second truth on the card.
    expect(screen.getByText("Recibido")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getAllByText("$1,800.00").length).toBeGreaterThanOrEqual(2); // total y saldo
    rendered.unmount();
  });

  it("marks reserved pieces once the first abono landed", () => {
    const rendered = render(
      <ToastProvider>
        <OrderCard order={{ ...planOrder, installmentsReservedAt: "2026-11-02T10:00:00.000Z" }} onEdit={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByText("Apartado")).toBeInTheDocument();
    rendered.unmount();
  });
});

it("uses recorded money for an ordinary order instead of the legacy deposit", () => {
  const ordinary: Order = { ...order, items: [{ productName: "Pieza", quantity: 1, unitPrice: 1000, subtotal: 1000 }], paymentsReceivedCents: 40000 };
  render(<ToastProvider><OrderCard order={ordinary} onEdit={() => {}} /></ToastProvider>);
  expect(screen.getByText("Recibido")).toBeInTheDocument();
  expect(screen.getByText("$400.00")).toBeInTheDocument();
  expect(screen.getByText("$600.00")).toBeInTheDocument();
});


it("opens receipt capture instead of declaring a legacy deposit collection successful", async () => {
  holder.upsertOrder.mockClear();
  const edit = vi.fn();
  render(<ToastProvider><OrderCard order={{ ...order, items: [{ productName: "Pieza", quantity: 1, unitPrice: 1000, subtotal: 1000 }], paymentsReceivedCents: 40000 }} onEdit={edit} /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
  expect(screen.getByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeEnabled());
  expect(holder.upsertOrder).not.toHaveBeenCalled();
  expect(edit).not.toHaveBeenCalled();
});
/** A received trip for store "s1": 10 anillos with $3.00 of delivery → 30¢ per piece. */
const tripWithDelivery: Purchase = {
  id: "trip", storeId: "s1", date: "2026-10-30", status: "received", costingMethod: "latest_purchase",
  receivedAt: "2026-11-01T00:00:00.000Z", subtotal: 100, totalConfirmed: 100, createdAt: "", updatedAt: "",
  lines: [{ lineId: "line", productId: "p1", name: "Anillo", quantity: 10, unitCost: 10 }],
  costAllocations: [{ lineId: "line", merchandiseCents: 10000, supplierAdjustmentCents: 0, sourcingExpenseCents: 0, saleExpenseCents: 300, totalCents: 10000 }],
};

const withCost: Order = {
  ...order, orderStatus: "delivered",
  items: [{ productId: "p1", productName: "Anillo", quantity: 3, unitPrice: 25, subtotal: 75, cost: 10 }],
};

describe("estimated profit on the order card", () => {
  it("shows profit = precio − costo de compra − gastos de venta, once each", () => {
    state.purchases = [tripWithDelivery];
    render(<ToastProvider><OrderCard order={withCost} onEdit={() => {}} /></ToastProvider>);
    // $75.00 − $30.00 − $0.90 (3 × 30¢ de entrega) = $44.10.
    expect(screen.getByText("$44.10")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByText("$0.90")).toBeInTheDocument();
  });

  it("keeps cash collected separate from profit (Saldo stays its own row)", () => {
    state.purchases = [tripWithDelivery];
    render(<ToastProvider><OrderCard order={withCost} onEdit={() => {}} /></ToastProvider>);
    expect(screen.getByText("Saldo")).toBeInTheDocument();
    expect(screen.getByText("Pagado")).toBeInTheDocument();
  });

  it("admits 'sin costo registrado' instead of inventing a profit", () => {
    state.purchases = [tripWithDelivery];
    const noCost = { ...withCost, items: [{ ...withCost.items[0], cost: undefined }] };
    render(<ToastProvider><OrderCard order={noCost} onEdit={() => {}} /></ToastProvider>);
    expect(screen.getByText(/sin costo registrado/)).toBeInTheDocument();
  });

  it("hides the estimate on a cancelled order (devolución total)", () => {
    state.purchases = [tripWithDelivery];
    render(<ToastProvider><OrderCard order={{ ...withCost, orderStatus: "cancelled" }} onEdit={() => {}} /></ToastProvider>);
    expect(screen.queryByText(/Ganancia estimada/)).toBeNull();
  });
});


describe("one-tap collection reconciliation (#218)", () => {
  it.each([true, false])("reports canonical collection (pinned=%s)", async (pinned) => {
    holder.payments = [];
    holder.upsertOrder.mockReset().mockResolvedValue({ ...order, deposit: pinned ? 0 : 1.25, ...(pinned ? { paymentsReceivedCents: 50 } : {}) });
    render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    if (pinned) {
      expect(await screen.findByText("Este pedido ya tiene cobros registrados. Regístralos en Cobros.")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
      expect(screen.queryByText("Pedido cobrado")).toBeNull();
    } else {
      expect(await screen.findByText("Pedido cobrado")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Cobros del pedido" })).toBeNull();
    }
  });
});

// #307 — modal de compartir en dos columnas: texto+Copiar (izquierda) y
// recibo+Imprimir (derecha) conviven al ancho; en angosto se apilan en orden
// de tarea. Cada panel es dueño de su acción.
describe("modal de compartir en dos columnas (#307)", () => {
  it("abre con texto, recibo y ambas acciones juntos; layout de dos columnas", () => {
    render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    const textArea = screen.getByLabelText("Detalle del pedido") as HTMLTextAreaElement;
    expect(textArea.value).toContain("Anillo");
    expect(screen.getByRole("button", { name: "Copiar detalle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir / Guardar PDF" })).toBeInTheDocument();
    expect(screen.getAllByText(/Solo el recibo sale en papel/).length).toBeGreaterThan(0); // una por panel (móvil/escritorio)
    // Two panels on one grid row at wide widths (lg:grid-cols-2).
    const grid = textArea.closest("div.grid");
    expect(grid?.className).toContain("lg:grid-cols-2");
    // The copy button lives in the text's panel; the print button in the receipt's.
    const textPanel = textArea.closest("div.min-w-0");
    const receiptButton = screen.getByRole("button", { name: "Imprimir / Guardar PDF" });
    const receiptPanel = receiptButton.closest("div.min-w-0");
    expect(textPanel?.contains(screen.getByRole("button", { name: "Copiar detalle" }))).toBe(true);
    expect(receiptPanel?.contains(receiptButton)).toBe(true);
    expect(textPanel).not.toBe(receiptPanel);
  });
});
