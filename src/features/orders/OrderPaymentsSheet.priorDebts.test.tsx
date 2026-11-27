// @vitest-environment jsdom
// #559: Cobros announces the clienta's prior debts next to the order saldo —
// the operator collecting knows the total owed, while cobros stay per-order
// (own file: the sheet suite's store mock has no orders).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderPaymentsSheet } from "./OrderPaymentsSheet";
import type { Order, OrderPayment } from "../../types";

const store = vi.hoisted(() => ({
  payments: [] as OrderPayment[],
  loadOrderPayments: vi.fn(),
  registerOrderPayment: vi.fn(),
  materializeInheritedDeposit: vi.fn(),
  state: {
    stores: [{ id: "s1", ownerUid: "owner-1" }],
    orders: [
      {
        id: "prior850",
        storeId: "s1",
        customerId: "c1",
        customerName: "Fer",
        items: [{ lineId: "l1", productName: "Collar", quantity: 1, unitPrice: 850 }],
        paymentsReceivedCents: 75000,
        inheritedDepositMaterialized: true,
        deposit: 0,
        orderStatus: "confirmed",
        paymentStatus: "partial",
        createdAt: "2026-11-20T10:00:00Z",
        updatedAt: "2026-11-20T10:00:00Z",
      },
    ] as unknown as Order[],
  },
  authUser: { uid: "owner-1", role: "member" } as { uid: string; role: string } | null,
}));
vi.mock("../../app/StoreProvider", () => ({ useStore: () => store }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("../../lib/router", () => ({ navigate }));

const current: Order = {
  id: "nuevo350",
  storeId: "s1",
  customerId: "c1",
  customerName: "Fer",
  items: [{ lineId: "l1", productName: "Aretes", quantity: 1, unitPrice: 350, subtotal: 350 }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
};

function renderSheet(onClose = () => {}) {
  return render(
    <ToastProvider>
      <OrderPaymentsSheet order={current} open onClose={onClose} />
    </ToastProvider>,
  );
}

describe("#559 — Cobros shows the prior debts of the clienta", () => {
  beforeEach(() => {
    store.payments = [];
    store.loadOrderPayments.mockReset().mockResolvedValue(undefined);
    store.registerOrderPayment.mockReset().mockResolvedValue(undefined);
    store.materializeInheritedDeposit.mockReset().mockResolvedValue(undefined);
    navigate.mockReset();
  });

  it("the reported case: saldo $350 · adeudo anterior $100 · por cobrar en total $450", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeEnabled());
    // Total and Saldo both read $350 (nothing received yet) — this order's money.
    expect(screen.getAllByText("$350.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Adeudo anterior")).toBeInTheDocument();
    // Expanded: the Σ row and the per-order row both carry the $100 — one debt,
    // never counted twice elsewhere.
    expect(screen.getAllByText("$100.00")).toHaveLength(2);
    expect(screen.getByText("Por cobrar en total")).toBeInTheDocument();
    expect(screen.getByText("$450.00")).toBeInTheDocument();
  });

  it("opens the order that originated the adeudo, closing the sheet", async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Ver pedido/ }));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/pedidos/prior850");
  });

  it("keeps the per-order cobro contract: registering still targets this order only", async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "350" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(store.registerOrderPayment).toHaveBeenCalledTimes(1));
    expect(store.registerOrderPayment).toHaveBeenCalledWith(current, expect.objectContaining({ amountText: "350" }));
  });
});
