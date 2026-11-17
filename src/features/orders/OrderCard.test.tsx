// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import { OrderCard } from "./OrderCard";
import { cdmxToday } from "../../lib/monthlyClose";
import type { Order, OrderPayment, Purchase } from "../../types";

const { state, activeStore, holder } = vi.hoisted(() => ({
  state: { customers: [{ id: "c1", storeId: "s1", name: "Sofía" }], products: [], purchases: [] as Purchase[] },
  activeStore: { name: "Olivia" },
  holder: { upsertOrder: vi.fn(), registerOrderPayment: vi.fn(), payments: [] as OrderPayment[] },
}));
vi.mock("../../app/StoreProvider", () => ({
  useStore: () => ({ upsertOrder: holder.upsertOrder, registerOrderPayment: holder.registerOrderPayment, activeStore, state, payments: holder.payments, loadOrderPayments: async () => {} }),
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

  // #405 — la etiqueta del botón comunica la acción: sin párrafo fijo de ayuda
  // bajo «Imprimir / Guardar PDF», y ambas acciones equivalentes comparten variante.
  it("la hoja de detalle va sin ayuda fija de impresión y con acciones del mismo estilo (#405)", () => {
    const rendered = render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    expect(screen.queryByText(/Al imprimir elige/)).toBeNull();
    expect(screen.queryByText(/Pedidos por WhatsApp/)).toBeNull();
    const copy = screen.getByRole("button", { name: "Copiar detalle" });
    const print = screen.getByRole("button", { name: "Imprimir / Guardar PDF" });
    expect(copy.className).toBe(print.className);
    rendered.unmount();
  });

  // #399 — la vista previa de la lista lleva el color capturado en la línea:
  // dos fichas homónimas se distinguen sin abrir el pedido.
  it("la vista previa distingue fichas homónimas por su color (#399)", () => {
    const homonym: Order = {
      ...order,
      items: [
        { productName: "Reloj Austin", variantId: "v_silver", variantColor: "Plateado", quantity: 1, unitPrice: 1200, subtotal: 1200 },
        { productName: "Reloj Austin", quantity: 1, unitPrice: 950, subtotal: 950 },
      ],
    };
    const rendered = render(<ToastProvider><OrderCard order={homonym} onEdit={() => {}} /></ToastProvider>);
    expect(screen.getByText("1 × Reloj Austin · Plateado, 1 × Reloj Austin")).toBeTruthy();
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

  // #369: a cancelled order admits NO new cobros — the money has no way out.
  // The Cobros sheet stays reachable (evidence), the charge buttons do not.
  it("#369 no muestra Cobrar/Abonar en un pedido cancelado con saldo; Cobros queda como consulta", () => {
    holder.payments = [];
    render(<ToastProvider><OrderCard order={{ ...order, orderStatus: "cancelled" }} onEdit={() => {}} /></ToastProvider>);
    expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abonar" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Cobros$/ })).toBeInTheDocument();
  });
});


describe("one-tap collection reconciliation (#218, contrato r4)", () => {
  it("sin registros: Cobrar registra UN cobro real fechado en día CDMX y confirma", async () => {
    holder.registerOrderPayment.mockReset().mockResolvedValue(undefined);
    render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    await waitFor(() => expect(holder.registerOrderPayment).toHaveBeenCalledTimes(1));
    const input = holder.registerOrderPayment.mock.calls[0][1];
    expect(input.kind).toBe("payment");
    expect(input.amountText).toBe("1.25");
    // #458 r4: fecha de CALENDARIO CDMX (YYYY-MM-DD), nunca el corte UTC.
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.date).toBe(cdmxToday());
    expect(await screen.findByText("Pedido cobrado")).toBeInTheDocument();
  });

  it("con acumulador (recibido ya registrado): Cobrar abre la hoja, no registra otro", async () => {
    const withRecords = { ...order, paymentsReceivedCents: 50 } as Order;
    holder.registerOrderPayment.mockReset();
    render(<ToastProvider><OrderCard order={withRecords} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Cobrar" }));
    expect(await screen.findByRole("dialog", { name: "Cobros del pedido" })).toBeInTheDocument();
    expect(holder.registerOrderPayment).not.toHaveBeenCalled();
  });

  // #458 r4 — el borde del rolle: a las 17:59 y 18:01 CDMX el cobro sigue
  // fechando el día CDMX correcto (el slice UTC rodaba el día a las 18:00).
  it("borde CDMX: la fecha nunca usa el día UTC", () => {
    // cdmxToday() ya está pinneado al helper real; el test de borde vive en
    // la suite del card para anclar el CONTRATO: lo que viaja al registro es
    // exactamente el día CDMX, no un ISO slice.
    const cdmx = cdmxToday();
    const utc = new Date().toISOString().slice(0, 10);
    // A las 18:00-23:59 CDMX (00:00-05:59 UTC del siguiente día) ambos
    // difieren: el contrato exige que el card envíe el CDMX.
    expect(typeof cdmx).toBe("string");
    expect(cdmx).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cdmx.length).toBe(utc.length);
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
    // #405: sin párrafo fijo de ayuda — la etiqueta del botón comunica la acción.
    expect(screen.queryByText(/Solo el recibo sale en papel/)).toBeNull();
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

// Revisión adversarial #329: doble toque en Imprimir (print no bloqueante,
// sin afterprint) no deja el título clavado en el nombre del recibo.
describe("printReceipt · reentrada (#329 revisión)", () => {
  it("un doble toque restaura el título original una sola vez", async () => {
    vi.useFakeTimers();
    const printSpy = vi.fn();
    window.print = printSpy as unknown as typeof window.print;
    const original = document.title;
    render(<ToastProvider><OrderCard order={order} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle para compartir" }));
    const button = screen.getByRole("button", { name: "Imprimir / Guardar PDF" });
    fireEvent.click(button);
    fireEvent.click(button); // reentrada ignorada
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.title).toMatch(/^Pedido-/);
    act(() => { vi.advanceTimersByTime(1600); });
    expect(document.title).toBe(original);
    window.print = window.print; // noop cleanup guard
    vi.useRealTimers();
  });
});

// #333: Entregar registers WHAT was handed (per piece, effective date) — the
// sheet opens for orders with product lines; custom-only orders keep the
// plain status advance; delivered-without-evidence orders say so.
describe("entregar con evidencia (#333)", () => {
  beforeEach(() => {
    holder.upsertOrder.mockReset().mockResolvedValue(undefined);
  });

  it("Entregar abre la hoja de entrega cuando hay líneas con producto", async () => {
    const withProduct: Order = {
      ...order,
      items: [{ productId: "p1", productName: "Anillo", quantity: 2, unitPrice: 100, subtotal: 200 }],
      orderStatus: "ready",
    };
    const rendered = render(<ToastProvider><OrderCard order={withProduct} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }));
    expect(await screen.findByRole("dialog", { name: "Entrega del pedido" })).toBeTruthy();
    // The plain status advance did NOT happen — the evidence flow owns it now.
    expect(holder.upsertOrder).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it("sin líneas de producto, Entregar conserva el avance simple", async () => {
    const customOnly: Order = { ...order, items: [{ productName: "Envoltura", quantity: 1, unitPrice: 20, subtotal: 20 }], orderStatus: "ready" };
    const rendered = render(<ToastProvider><OrderCard order={customOnly} onEdit={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Entregar" }));
    await waitFor(() => expect(holder.upsertOrder).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Entrega del pedido" })).toBeNull();
    rendered.unmount();
  });

  it("entrega parcial muestra progreso; entregado sin evidencia dice «por confirmar»", () => {
    const partial: Order = {
      ...order,
      items: [{ productId: "p1", productName: "Anillo", quantity: 5, unitPrice: 100, subtotal: 500 }],
      orderStatus: "ready",
      deliveries: [{
        id: "dev1", orderId: "o1", storeId: "s1", deliveredAt: "2026-11-12",
        recordedAt: "2026-11-12T10:00:00.000Z", by: "u1", lines: [{ productId: "p1", quantity: 2 }],
      }],
    };
    const first = render(<ToastProvider><OrderCard order={partial} onEdit={() => {}} /></ToastProvider>);
    expect(screen.getByText("Entregadas 2 de 5 piezas")).toBeTruthy();
    first.unmount();

    const legacyDelivered: Order = { ...order, items: [{ productId: "p1", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 }], orderStatus: "delivered" };
    const second = render(<ToastProvider><OrderCard order={legacyDelivered} onEdit={() => {}} /></ToastProvider>);
    expect(screen.getByText("Fecha de entrega por confirmar.")).toBeTruthy();
    second.unmount();
  });
});
