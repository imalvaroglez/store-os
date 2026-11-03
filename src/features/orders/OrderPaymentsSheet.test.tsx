// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderPaymentsSheet } from "./OrderPaymentsSheet";
import type { Order, OrderPayment } from "../../types";

const store = vi.hoisted(() => ({
  payments: [] as OrderPayment[],
  loadOrderPayments: vi.fn(),
  registerOrderPayment: vi.fn(),
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => store }));

const order: Order = {
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "l1", productName: "Caja adviento", quantity: 1, unitPrice: 1500, subtotal: 1500 }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const transfer = (amount: number, date: string, id: string): OrderPayment => ({
  id,
  orderId: "o1",
  storeId: "s1",
  date,
  method: "transfer",
  kind: "payment",
  amount,
  createdAt: `${date}T12:00:00.000Z`,
  createdBy: "u1",
});

function renderSheet() {
  return render(
    <ToastProvider>
      <OrderPaymentsSheet order={order} open onClose={() => {}} />
    </ToastProvider>
  );
}

describe("OrderPaymentsSheet", () => {
  beforeEach(() => {
    store.payments = [];
    store.loadOrderPayments.mockReset().mockResolvedValue(undefined);
    store.registerOrderPayment.mockReset().mockResolvedValue(undefined);
  });

  it("lists the payments with method and amount, and shows received/balance (issue case)", async () => {
    store.payments = [
      transfer(1010, "2026-10-31", "p1"),
      { id: "p2", orderId: "o1", storeId: "s1", date: "2026-11-01", method: "cash", kind: "payment", amount: 200, createdAt: "2026-11-01T12:00:00.000Z", createdBy: "u1" },
    ];
    renderSheet();
    expect(await screen.findByText("Transferencia")).toBeInTheDocument();
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByText("$1,010.00")).toBeInTheDocument();
    expect(screen.getByText("$200.00")).toBeInTheDocument();
    expect(screen.getByText("Recibido")).toBeInTheDocument();
    expect(screen.getByText("$1,210.00")).toBeInTheDocument();
    expect(screen.getByText("$290.00")).toBeInTheDocument(); // saldo contra $1,500
    expect(store.loadOrderPayments).toHaveBeenCalledWith("o1");
  });

  it("registers a cobro with amount, method and date through the store action", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Fecha de recepción"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(store.registerOrderPayment).toHaveBeenCalledTimes(1));
    expect(store.registerOrderPayment).toHaveBeenCalledWith(
      order,
      expect.objectContaining({ kind: "payment", method: "cash", amountText: "150", date: "2026-11-02" })
    );
  });

  it("reuses the same record id on retry so a resend never duplicates", async () => {
    store.registerOrderPayment.mockRejectedValue(new Error(""));
    renderSheet();
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(screen.getByText(/No se pudo registrar/i)).toBeInTheDocument());
    store.registerOrderPayment.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(store.registerOrderPayment).toHaveBeenCalledTimes(2));
    const first = store.registerOrderPayment.mock.calls[0][1] as { id: string };
    const second = store.registerOrderPayment.mock.calls[1][1] as { id: string };
    expect(first.id).toBe(second.id);
  });

  it("demands the anticipo's date/method on the first payment of a pending inherited deposit (PO 2026-11-03)", async () => {
    const inheritedOrder: Order = { ...order, deposit: 400 };
    render(
      <ToastProvider>
        <OrderPaymentsSheet order={inheritedOrder} open onClose={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByText(/Anticipo previo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Método del anticipo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fecha del anticipo/i)).toBeInTheDocument();
    // The pending deposit already counts as received: saldo 1,500 − 400.
    expect(screen.getByText("$1,100.00")).toBeInTheDocument();

    // Without the anticipo date the first payment is rejected — nothing saved.
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    expect(await screen.findByText(/estímala si no la recuerdas/i)).toBeInTheDocument();
    expect(store.registerOrderPayment).not.toHaveBeenCalled();

    // Supplying the estimated date lets the payment through, carrying it.
    fireEvent.change(screen.getByLabelText(/Fecha del anticipo/i), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(store.registerOrderPayment).toHaveBeenCalledTimes(1));
    expect(store.registerOrderPayment).toHaveBeenCalledWith(
      inheritedOrder,
      expect.objectContaining({ kind: "payment", inherited: { method: "cash", date: "2026-10-20" } })
    );
  });
});

describe("OrderPaymentsSheet installment calendar (#165)", () => {
  const planOrder: Order = {
    ...order,
    items: [{ lineId: "l1", productName: "Caja adviento", quantity: 1, unitPrice: 1800, subtotal: 1800 }],
    installments: { count: 6, frequency: "monthly", firstDueDate: "2026-11-15", agreedAt: "2026-11-01", agreedBy: "u1" },
  };

  beforeEach(() => {
    store.payments = [];
    store.loadOrderPayments.mockReset().mockResolvedValue(undefined);
    store.registerOrderPayment.mockReset().mockResolvedValue(undefined);
  });

  function renderPlanSheet(orderOverride: Order = planOrder) {
    return render(
      <ToastProvider>
        <OrderPaymentsSheet order={orderOverride} open onClose={() => {}} />
      </ToastProvider>
    );
  }

  it("shows the expected calendar separately from received and balance", async () => {
    store.payments = [transfer(100, "2026-11-02", "p1")];
    // #168: the calendar reads the order doc accumulator (the same Σ the
    // records below carry — the sheet lists them as evidence).
    renderPlanSheet({ ...planOrder, paymentsReceivedCents: 10000 });
    expect(await screen.findByText("Calendario previsto")).toBeInTheDocument();
    expect(screen.getByText(/Cuota 1 ·/)).toBeInTheDocument();
    expect(screen.getByText(/Cuota 6 ·/)).toBeInTheDocument();
    expect(screen.getAllByText("$300.00").length).toBeGreaterThanOrEqual(6);
    // $100 cubre parcialmente la cuota más próxima; 2 recibos ≠ 2 cuotas.
    expect(screen.getByText("Parcial")).toBeInTheDocument();
    expect(screen.getByText("0 de 6 cubiertas")).toBeInTheDocument();
    // Recibido y saldo siguen siendo los mismos cobros de #123.
    expect(screen.getByText("Recibido")).toBeInTheDocument();
    expect(screen.getAllByText("$100.00").length).toBeGreaterThanOrEqual(2); // recibido y registro
    expect(screen.getByText("$1,700.00")).toBeInTheDocument();
  });

  it("tells the operator the pieces are NOT reserved until the first abono, and delivery waits", async () => {
    renderPlanSheet();
    expect(await screen.findByText(/se aparta con el primer abono/i)).toBeInTheDocument();
    expect(screen.getByText(/entrega se habilita al liquidar/i)).toBeInTheDocument();
  });

  it("marks the reservation and covered cuotas as money arrives (illustrative case)", async () => {
    store.payments = [1, 2, 3, 4, 5].map((n) => transfer(300, `2026-11-${String(n).padStart(2, "0")}`, `p${n}`));
    renderPlanSheet({ ...planOrder, installmentsReservedAt: "2026-11-02T10:00:00.000Z", paymentsReceivedCents: 150000 });
    expect(await screen.findByText(/apartadas desde el primer abono/i)).toBeInTheDocument();
    expect(screen.getByText("5 de 6 cubiertas")).toBeInTheDocument();
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getAllByText("$300.00").length).toBeGreaterThanOrEqual(2); // cuotas y saldo
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("flags late cuotas informationally — no penalties exist", async () => {
    renderPlanSheet({
      ...planOrder,
      installments: { count: 6, frequency: "monthly", firstDueDate: "2026-08-15", agreedAt: "2026-08-01", agreedBy: "u1" },
    });
    expect(screen.getAllByText("Atrasada").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the plain payments sheet for ordinary orders", async () => {
    renderPlanSheet({ ...order });
    expect(await screen.findByText(/Sin cobros registrados/i)).toBeInTheDocument();
    expect(screen.queryByText("Calendario previsto")).toBeNull();
  });
});
