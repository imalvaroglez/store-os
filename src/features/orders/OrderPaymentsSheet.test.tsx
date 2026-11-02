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

  it("shows an unmaterialized inherited deposit as unknown money, without inventing data", () => {
    const inheritedOrder: Order = { ...order, deposit: 400 };
    const { rerender } = render(
      <ToastProvider>
        <OrderPaymentsSheet order={inheritedOrder} open onClose={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByText(/Anticipo heredado/i)).toBeInTheDocument();
    expect(screen.getByText(/desconocid/i)).toBeInTheDocument();
    // $400 appears both in the banner and as Recibido — both must exist.
    expect(screen.getAllByText("$400.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$1,100.00")).toBeInTheDocument(); // saldo 1,500 − 400
    rerender(
      <ToastProvider>
        <OrderPaymentsSheet order={inheritedOrder} open={false} onClose={() => {}} />
      </ToastProvider>
    );
  });
});
