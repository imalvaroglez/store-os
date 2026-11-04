// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderCard } from "./OrderCard";
import type { Order, OrderPayment } from "../../types";

const { state, activeStore, holder } = vi.hoisted(() => ({
  state: { customers: [{ id: "c1", storeId: "s1", name: "Sofía" }], products: [] },
  activeStore: { name: "Olivia" },
  holder: { upsertOrder: vi.fn(), payments: [] as OrderPayment[] },
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({ upsertOrder: holder.upsertOrder, activeStore, state, payments: holder.payments }),
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
    expect(text.value).toContain("Total: $1.25");
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
