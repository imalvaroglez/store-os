// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("OrderReceipt (#139)", () => {
  it("muestra el recibo con el dinero canónico del ticket de texto", () => {
    const data = orderTicketData(order, "Olivia");
    render(<OrderReceipt data={data} />);
    const preview = within(screen.getByTestId("receipt-preview"));
    const printRoot = document.getElementById("receipt-print-root");
    expect(printRoot?.parentElement).toBe(document.body);
    expect(preview.getByText("Olivia")).toBeTruthy();
    expect(preview.getByText("Recibo de pedido")).toBeTruthy();
    expect(preview.getByText("Linda")).toBeTruthy();
    // Cada línea numerada con su total (la cantidad viaja en la etiqueta)…
    const row = (label: string) => preview.getByText(label).closest("li")!.textContent;
    expect(row("2 × Aretes Luna")).toContain("1.");
    expect(row("Anillo Sol")).toContain("2.");
    expect(preview.getByText("$301")).toBeTruthy();
    expect(preview.getByText("$320")).toBeTruthy();
    // …y el dinero coincide EXACTO con el texto que Fer manda por WhatsApp.
    expect(preview.getByText(data.total).textContent).toBe(data.total);
    expect(preview.getByText("Cobrado").parentElement?.textContent).toContain(data.cobrado);
    expect(data.cobrado).toBe("$400");
    expect(data.saldo).toBeDefined(); // 621 − 400 abonados
    expect(preview.getByText(data.saldo!)).toBeTruthy();
    // El texto de WhatsApp (#222) ya no lleva Cobrado: la coherencia texto↔PDF
    // se asegura comparando contra el mismo builder canónico que alimenta ambos.
    const text = orderTicketText(order, "Olivia");
    expect(text).toContain(`*Total* ${data.total}`);
    expect(text).toContain(`*Saldo* ${data.saldo}`);
    // #405: el recibo no ofrece canal de pedidos — el catálogo es el canal;
    // WhatsApp queda para compartir el detalle como texto.
    expect(preview.queryByText(/Pedidos por WhatsApp/)).toBeNull();
    expect(printRoot?.textContent).not.toContain("Pedidos por WhatsApp");
  });

  it("sin saldo pendiente no imprime línea de Saldo (espejo del formato de texto)", () => {
    const paid = { ...order, deposit: 621, paymentsReceivedCents: 62100, inheritedDepositMaterialized: true } as unknown as Order;
    const data = orderTicketData(paid, "Olivia");
    render(<OrderReceipt data={data} />);
    expect(data.saldo).toBeUndefined();
    const preview = within(screen.getByTestId("receipt-preview"));
    expect(preview.queryByText("Saldo")).toBeNull();
    expect(preview.getByText("Cobrado").parentElement?.textContent).toContain("$621");
    expect(orderTicketText(paid, "Olivia")).not.toContain("Saldo");
  });

  it("muestra $0 cobrado y SIN línea de Saldo si no hay anticipos ni pagos (#306)", () => {
    const unpaid = { ...order, deposit: 0, paymentsReceivedCents: 0 } as unknown as Order;
    const data = orderTicketData(unpaid, "Olivia");
    render(<OrderReceipt data={data} />);
    const preview = within(screen.getByTestId("receipt-preview"));
    expect(data.cobrado).toBe("$0");
    expect(data.saldo).toBeUndefined(); // sin dinero recibido, el Saldo no repite el Total
    expect(preview.getByText("Cobrado").parentElement?.textContent).toContain("$0");
    expect(orderTicketText(unpaid, "Olivia")).not.toContain("*Saldo*");
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
    // The print-only document escapes the Sheet's clipping and scroll parent.
    const printRoot = document.getElementById("receipt-print-root");
    expect(printRoot?.parentElement).toBe(document.body);
    expect(document.body.classList.contains("receipt-print-scope")).toBe(true);
  });
});

// #306 (revisión adversarial P3 + Fer-reader): el recibo también muestra el
// excedente, como "A tu favor" — "Saldo a favor" leía como deuda a una clienta.
describe("OrderReceipt · saldo a favor (#306)", () => {
  it("con excedente real imprime la línea A tu favor junto al Cobrado", () => {
    const overpaid = { ...order, deposit: 921 } as unknown as Order;
    const data = orderTicketData(overpaid, "Olivia");
    render(<OrderReceipt data={data} />);
    expect(data.availableCredit).toBe("$300");
    expect(screen.getAllByText("A tu favor").length).toBeGreaterThan(0); // preview + copia de impresión
    expect(screen.queryAllByText("Saldo").length).toBe(0);
  });
});
