// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../../design-system";
import { OrderReceipt } from "./OrderReceipt";
import { OrderCard } from "./OrderCard";
import { orderTicketData, orderTicketText } from "./orderTicket";
import type { Order } from "../../types";

vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({
    upsertOrder: vi.fn(),
    activeStore: { name: "Olivia" },
    state: { customers: [], products: [], purchases: [] },
    payments: [],
    loadOrderPayments: async () => {},
  }),
}));

const order = {
  id: "order_1",
  storeId: "store_olivia",
  customerName: "Linda",
  createdAt: "2026-11-05",
  items: [
    { productName: "Aretes Luna", quantity: 2, unitPrice: 150.5, subtotal: 301 },
    { productName: "Anillo Sol", quantity: 1, unitPrice: 320, subtotal: 320 },
  ],
  deposit: 400,
  orderStatus: "building",
  paymentStatus: "partial",
  schemaVersion: 2,
  createdAt2: "",
} as unknown as Order;

beforeEach(() => localStorage.clear());

describe("OrderReceipt (#139)", () => {
  it("muestra el recibo con el dinero canónico del ticket de texto", () => {
    const data = orderTicketData(order, "Olivia");
    render(<OrderReceipt data={data} whatsapp="5215512345678" />);
    // Raíz de impresión: el CSS @media print aísla exactamente este nodo.
    expect(document.getElementById("receipt-print-root")).toBeTruthy();
    expect(screen.getByText("Olivia")).toBeTruthy();
    expect(screen.getByText("Recibo de pedido")).toBeTruthy();
    expect(screen.getByText("Linda")).toBeTruthy();
    // Cada línea numerada con su total (la cantidad viaja en la etiqueta)…
    const row = (label: string) => screen.getByText(label).closest("li")!.textContent;
    expect(row("2 × Aretes Luna")).toContain("1.");
    expect(row("Anillo Sol")).toContain("2.");
    expect(screen.getByText("$301.00")).toBeTruthy();
    expect(screen.getByText("$320.00")).toBeTruthy();
    // …y el dinero coincide EXACTO con el texto que Fer manda por WhatsApp.
    expect(screen.getByText("$621.00").textContent).toBe(data.total);
    expect(data.saldo).toBeDefined(); // 621 − 400 abonados
    expect(screen.getByText(data.saldo!)).toBeTruthy();
    const text = orderTicketText(order, "Olivia");
    expect(text).toContain(`Total ${data.total}`);
    expect(text).toContain(`Saldo ${data.saldo}`);
    expect(screen.getByText(/Pedidos por WhatsApp/)).toBeTruthy();
  });

  it("sin saldo pendiente no imprime línea de Saldo (espejo del formato de texto)", () => {
    const paid = { ...order, deposit: 621, paymentsReceivedCents: 62100 } as unknown as Order;
    const data = orderTicketData(paid, "Olivia");
    render(<OrderReceipt data={data} />);
    expect(data.saldo).toBeUndefined();
    expect(screen.queryByText("Saldo")).toBeNull();
  });

  it("el botón del Sheet dispara la impresión del navegador", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <ToastProvider>
        <OrderCard order={order} onEdit={() => {}} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    fireEvent.click(screen.getByRole("button", { name: "Imprimir / Guardar PDF" }));
    expect(print).toHaveBeenCalled();
    // En el Sheet también vive el recibo imprimible (raíz del CSS de impresión)
    // y el alcance de impresión solo existe mientras el recibo está montado:
    // un Ctrl+P fuera del recibo imprime la página normal, no una hoja en blanco.
    expect(document.getElementById("receipt-print-root")).toBeTruthy();
    expect(document.body.classList.contains("receipt-print-scope")).toBe(true);
  });
});
