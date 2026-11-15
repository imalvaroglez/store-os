// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button, ToastProvider } from "../../design-system";
import type { PdfApplyPayload } from "./PurchasePdfImport";
import type { Purchase } from "../../types";
import { PurchaseForm } from "./PurchaseForm";
import { StalePurchaseError } from "../../app/firebase/firestoreData";

const { upsertPurchase, upsertProduct, receivePurchase, adjustReceivedPurchase, pdfPayloads, activeStore, state, createDraftProductsForPurchase } = vi.hoisted(() => ({
  upsertPurchase: vi.fn().mockResolvedValue(undefined),
  createDraftProductsForPurchase: vi.fn().mockResolvedValue(undefined),
  upsertProduct: vi.fn().mockResolvedValue(undefined),
  receivePurchase: vi.fn().mockResolvedValue("received"),
  adjustReceivedPurchase: vi.fn(),
  pdfPayloads: [] as PdfApplyPayload[],
  activeStore: { id: "olivia", name: "Olivia", type: "inventory_tiered" as const },
  state: {
    suppliers: [],
    products: [{
      id: "ring", storeId: "olivia", name: "Anillo", cost: 99,
      quantityOnHand: 3, createdAt: "", updatedAt: "",
    }, {
      id: "foreign", storeId: "another_store", name: "Anillo de otra tienda", cost: 25,
      quantityOnHand: 2, createdAt: "", updatedAt: "",
    }],
  },
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../app/StoreProvider")>(),
  useStore: () => ({ state, activeStore, upsertPurchase, upsertProduct, receivePurchase, adjustReceivedPurchase, createDraftProductsForPurchase, cloud: true }),
}));
vi.mock("./PurchasePdfImport", () => ({
  PurchasePdfImport: ({ onApply }: { onApply: (payload: PdfApplyPayload) => void }) => <Button onClick={() => onApply(pdfPayloads.shift()!)}>Importar PDF de prueba</Button>,
}));

function purchase(): Purchase {
  return {
    id: "purchase", storeId: "olivia", date: "2026-10-30", status: "draft",
    lines: [{ lineId: "line", productId: "", name: "Pieza del ticket", quantity: 4, unitCost: 16.45 }],
    subtotal: 65.8, totalConfirmed: 65.8, createdAt: "", updatedAt: "",
  };
}

function open(value = purchase()) {
  render(<ToastProvider><PurchaseForm purchase={value} onDone={() => {}} /></ToastProvider>);
}

beforeEach(() => { createDraftProductsForPurchase.mockClear().mockResolvedValue(undefined); upsertPurchase.mockClear(); upsertProduct.mockReset().mockResolvedValue(undefined); receivePurchase.mockReset().mockResolvedValue("received"); adjustReceivedPurchase.mockReset().mockResolvedValue(undefined); pdfPayloads.length = 0; });

describe("sale expenses and post-reception adjustments (FER-02)", () => {
  function receivedPurchase(): Purchase {
    return {
      ...purchase(),
      status: "received",
      receivedAt: "2026-11-01T12:00:00Z",
      costingMethod: "latest_purchase",
      tickets: [{ id: "ticket:purchase", totalConfirmed: 65.8 }],
      lines: [{ lineId: "line", ticketId: "ticket:purchase", productId: "ring", name: "Pieza del ticket", quantity: 4, unitCost: 16.45 }],
      costAllocations: [{ lineId: "line", merchandiseCents: 6580, supplierAdjustmentCents: 0, sourcingExpenseCents: 0, saleExpenseCents: 0, totalCents: 6580 }],
    };
  }

  it("explains a sale expense per piece without offering it as inventory cost", async () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar gasto" }));
    fireEvent.change(screen.getByLabelText("Tipo de gasto"), { target: { value: "customer_delivery" } });
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "25" } });
    expect(screen.getByText(/Se reparte entre las piezas del viaje y se cuenta al vender/)).toBeVisible();
    expect(screen.queryByLabelText("Costo del inventario")).not.toBeInTheDocument();
    // The cost card shows the sale allocation without touching piece cost.
    expect(screen.getByText("Gastos de venta repartidos")).toBeVisible();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(1);
    expect(screen.getByText("Costo completo de las piezas").parentElement).toHaveTextContent("$65.80");
  });

  it("adds a sale expense after receiving and keeps the received evidence intact", async () => {
    const value = receivedPurchase();
    adjustReceivedPurchase.mockResolvedValueOnce({
      ...value,
      saleCostAdjustments: [{ id: "adj1", at: "2026-11-02T12:00:00Z", category: "customer_delivery", amount: 25, allocations: [{ lineId: "line", saleExpenseCents: 2500 }] }],
    });
    open(value);
    fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar gasto después de recibir" }));
    fireEvent.change(screen.getByLabelText("Tipo de gasto"), { target: { value: "customer_delivery" } });
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(adjustReceivedPurchase).toHaveBeenCalledOnce());
    const [purchaseArg, expenseArg] = adjustReceivedPurchase.mock.calls[0];
    expect(purchaseArg.id).toBe("purchase");
    expect(expenseArg).toMatchObject({ category: "customer_delivery", amount: 25 });
    expect(expenseArg.id).toBeTruthy();
    // The append-only entry is visible with its exact allocation.
    expect(screen.getByText(/Entrega a clienta/)).toBeVisible();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/repartido entre 4 piezas/)).toBeVisible();
    // The original inventory snapshot stays untouched.
    expect(screen.getByText("Costo completo de las piezas").parentElement).toHaveTextContent("$65.80");
  });

  it("rejects a late expense without a positive amount", async () => {
    open(receivedPurchase());
    fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar gasto después de recibir" }));
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(screen.getByText("Escribe un importe mayor que cero.")).toBeVisible();
    expect(adjustReceivedPurchase).not.toHaveBeenCalled();
  });

  it("explains a Firestore failure when saving the late expense", async () => {
    adjustReceivedPurchase.mockRejectedValueOnce(Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" }));
    open(receivedPurchase());
    fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar gasto después de recibir" }));
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(screen.getByText("No se pudo guardar el gasto. Revisa tu conexión e intenta de nuevo.")).toBeVisible());
  });
});

describe("purchase amount entry", () => {
  it("keeps the decimal separator when entering a cost one key at a time", async () => {
    open();
    const cost = screen.getByLabelText("Costo unitario") as HTMLInputElement;
    fireEvent.change(cost, { target: { value: "" } });
    for (const char of "16.45") fireEvent.change(cost, { target: { value: cost.value + char } });
    expect(cost).toHaveValue("16.45");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0].unitCost).toBe(16.45);
  });

  it("preserves the purchase cost when linking a product with a different stored cost", async () => {
    open();
    const search = screen.getByRole("combobox", { name: "Producto en Store OS" });
    fireEvent.change(search, { target: { value: "Anillo" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /Anillo/ }));
    expect(screen.getByLabelText("Costo unitario")).toHaveValue("16.45");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0]).toMatchObject({ productId: "ring", unitCost: 16.45 });
  });

  it.each([0, 16.45])("preserves an explicit %s cost and unresolved imported semantics when linking", async (amount) => {
    const value = purchase();
    value.lines[0] = { ...value.lines[0], unitCost: amount, sourceAmount: 80, sourceAmountType: "unknown" };
    open(value);
    fireEvent.change(screen.getByRole("combobox", { name: "Producto en Store OS" }), { target: { value: "Anillo" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Producto en Store OS" }), { key: "Enter" });
    expect(screen.getByLabelText("Costo unitario")).toHaveValue(String(amount));
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0]).toMatchObject({ productId: "ring", unitCost: amount, sourceAmountType: "unknown" });
  });

  it("keeps adjustment decimals while editing and saves numeric amounts", async () => {
    open();
    for (const label of ["Descuento", "Envío", "Impuestos", "Total pagado"]) {
      const input = screen.getByLabelText(label, { exact: true }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "" } });
      for (const char of "0.50") fireEvent.change(input, { target: { value: input.value + char } });
      expect(input).toHaveValue("0.50");
    }
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].tickets[0]).toMatchObject({ discount: 0.5, shipping: 0.5, tax: 0.5, totalConfirmed: 0.5 });
  });
  it("lets the operator clear and type 70 pieces without restoring an unwanted leading one", async () => {
    open();
    const quantity = screen.getByLabelText("Cantidad", { exact: true }) as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: "" } });
    expect(quantity).toHaveValue("");
    for (const char of "70") fireEvent.change(quantity, { target: { value: quantity.value + char } });
    expect(quantity).toHaveValue("70");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0].quantity).toBe(70);
  });
  it("does not save an invalid visible amount as a silent zero", () => {
    open();
    fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(upsertPurchase).not.toHaveBeenCalled();
    expect(screen.getByText("Revisa los importes y las cantidades que estás escribiendo.")).toBeVisible();
  });
  it("explains a Firebase receipt failure in Spanish and keeps the purchase open", async () => {
    receivePurchase.mockRejectedValueOnce(Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" }));
    const value = purchase();
    value.lines[0].productId = "ring";
    open(value);
    fireEvent.click(screen.getByRole("button", { name: "Recibir mercancía" }));
    await waitFor(() => expect(screen.getByText("No se pudo recibir la mercancía. Intenta de nuevo.")).toBeVisible());
    expect(screen.queryByText("Missing or insufficient permissions")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Costo unitario")).toHaveValue("16.45");
  });

  it("does not move an edited cost to another line when the preceding row is removed", () => {
    const value = purchase();
    value.lines.push({ lineId: "second", productId: "", name: "Segunda", quantity: 1, unitCost: 7 });
    open(value);
    fireEvent.change(screen.getAllByLabelText("Costo unitario")[1], { target: { value: "7.05" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar línea" })[0]);
    expect(screen.getByLabelText("Costo unitario")).toHaveValue("7.05");
  });

  it("locks product lookup and costs for a received purchase", () => {
    open({ ...purchase(), status: "received" });
    expect(screen.getByRole("combobox", { name: "Producto en Store OS" })).toBeDisabled();
    expect(screen.getByLabelText("Costo unitario")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar borrador" })).not.toBeInTheDocument();
  });

  it("keeps product creation reachable above results even when nothing matches", () => {
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Producto en Store OS" }), { target: { value: "Nueva pieza" } });
    const create = screen.getByRole("button", { name: "+ Crear nuevo producto" });
    expect(create).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("No hay coincidencias");
    expect(screen.queryByRole("button", { name: "Crear 1 producto" })).not.toBeInTheDocument();
  });

  it("keeps the new product form open after a failed save so the operator can retry", async () => {
    upsertProduct.mockRejectedValueOnce(new Error("offline"));
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Producto en Store OS" }), { target: { value: "Nueva pieza" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Crear nuevo producto" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(screen.getByText("No se pudo crear el producto. Revisa tu conexión e intenta de nuevo.")).toBeVisible());
    expect(screen.getByRole("dialog", { name: "Nuevo producto" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nuevo producto" })).not.toBeInTheDocument());
    expect(upsertProduct).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Costo unitario")).toHaveValue("16.45");
  });

  it("keeps both PDFs and their line-to-ticket relationship when importing a second ticket", async () => {
    pdfPayloads.push({ supplierOrder: "PDF-A", supplierCandidate: "Proveedor A", total: 20, fingerprint: "a".repeat(64), documentPath: "private/pdf-a.pdf", lines: [{ productId: "", name: "Primero", quantity: 2, unitCost: 10 }] });
    pdfPayloads.push({ supplierOrder: "PDF-B", supplierCandidate: "Proveedor B", total: 15, fingerprint: "b".repeat(64), documentPath: "private/pdf-b.pdf", lines: [{ productId: "", name: "Segundo", quantity: 3, unitCost: 5 }] });
    open({ ...purchase(), lines: [], subtotal: 0, totalConfirmed: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Importar PDF de prueba" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar ticket" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar PDF de prueba" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    const saved = upsertPurchase.mock.calls[0][0] as Purchase;
    expect(saved.lines.map((line) => line.name)).toEqual(["Primero", "Segundo"]);
    expect(saved.tickets!.map((ticket) => ticket.folio)).toEqual(["PDF-A", "PDF-B"]);
    expect(saved.tickets!.map((ticket) => ticket.documentPath)).toEqual(["private/pdf-a.pdf", "private/pdf-b.pdf"]);
    expect(saved.lines.map((line) => line.ticketId)).toEqual(saved.tickets!.map((ticket) => ticket.id));
    expect(saved.totalConfirmed).toBe(35);
  });
  it("interprets each supplier ticket independently without overwriting the others", async () => {
    const value: Purchase = {
      ...purchase(), totalConfirmed: 70,
      tickets: [{ id: "a", folio: "A", totalConfirmed: 40 }, { id: "b", folio: "B", totalConfirmed: 30 }],
      lines: [
        { lineId: "a-line", ticketId: "a", productId: "ring", name: "A", quantity: 2, unitCost: 0, sourceAmount: 20, sourceAmountType: "unknown" },
        { lineId: "b-line", ticketId: "b", productId: "ring", name: "B", quantity: 3, unitCost: 0, sourceAmount: 30, sourceAmountType: "unknown" },
      ],
    };
    open(value);
    fireEvent.click(screen.getByRole("button", { name: "Unitarios" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    const first = upsertPurchase.mock.calls[0][0] as Purchase;
    expect(first.lines[0]).toMatchObject({ unitCost: 20, sourceAmountType: "unit" });
    expect(first.lines[1]).toMatchObject({ unitCost: 0, sourceAmountType: "unknown" });
    fireEvent.click(screen.getByRole("tab", { name: /#B/ }));
    fireEvent.click(screen.getByRole("button", { name: "Total por línea" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledTimes(2));
    expect(upsertPurchase.mock.calls[1][0].lines[0].unitCost).toBe(20);
    expect(upsertPurchase.mock.calls[1][0].lines[1]).toMatchObject({ unitCost: 10, sourceAmountType: "line" });
  });
});

describe("ticket capture and journey review (#206)", () => {
  const journey = (): Purchase => ({
    ...purchase(), totalConfirmed: 30,
    tickets: [{ id: "a", folio: "A", totalConfirmed: 10 }, { id: "b", folio: "B", totalConfirmed: 20 }],
    lines: [
      { lineId: "a1", ticketId: "a", productId: "ring", name: "Pieza A", quantity: 1, unitCost: 10 },
      { lineId: "b1", ticketId: "b", productId: "ring", name: "Pieza B", quantity: 2, unitCost: 10 },
    ],
  });

  it("captures only the active ticket, preserves its money text and saves every ticket", async () => {
    open(journey());
    expect(screen.getAllByLabelText("Producto", { exact: true })).toHaveLength(1);
    expect(screen.getByLabelText("Producto", { exact: true })).toHaveValue("Pieza A");
    expect(screen.queryByLabelText("Ticket de esta línea")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Total pagado", { exact: true }), { target: { value: "10." } });
    fireEvent.click(screen.getByRole("tab", { name: /#B/ }));
    expect(screen.getByLabelText("Producto", { exact: true })).toHaveValue("Pieza B");
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar línea" }));
    fireEvent.click(screen.getByRole("tab", { name: /#A/ }));
    expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveValue("10.");
    expect(screen.getAllByLabelText("Producto", { exact: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines.map((line: { ticketId: string }) => line.ticketId)).toEqual(["a", "b", "b"]);
  });

  it("preserves invalid ticket text across tabs and takes review errors to the exact field", async () => {
    open(journey());
    fireEvent.change(screen.getByLabelText("Total pagado", { exact: true }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: /#B/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(upsertPurchase).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Resumen de tickets" })).toHaveFocus();
    const fix = screen.getByRole("button", { name: /#A.*Total pagado/ });
    fireEvent.click(fix);
    await waitFor(() => expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveFocus());
    expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Total pagado", { exact: true }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
  });

  it("separates global filters from capture and does not show a blank PDF amount column", () => {
    open(journey());
    expect(screen.queryByText("Importe", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Todas (2)" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
    fireEvent.click(screen.getByText("Revisar productos (2 renglones)", { exact: true }));
    expect(screen.getByRole("button", { name: "Todas (2)" })).toBeVisible();
    expect(screen.getAllByLabelText("Producto", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Resumen de tickets" })).toHaveTextContent("#A");
    expect(screen.getByRole("region", { name: "Resumen de tickets" })).toHaveTextContent("#B");
  });

  it("does not announce a saved draft until persistence resolves, and retains data after rejection", async () => {
    let reject!: (error: Error) => void;
    upsertPurchase.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    open(journey());
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(screen.queryByText("Borrador guardado.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    reject(new Error("offline"));
    await waitFor(() => expect(screen.getByText("No se pudo guardar la compra. Revisa tu conexión e intenta de nuevo.")).toBeVisible());
    expect(screen.getByLabelText("Producto", { exact: true })).toHaveValue("Pieza A");
  });
});

it("importing a new ticket preserves invalid text in the previous ticket", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Total pagado", { exact: true }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Agregar ticket" }));
  pdfPayloads.push({ supplierOrder: "PDF-NEW", total: 15, lines: [{ productId: "ring", name: "PDF piece", quantity: 3, unitCost: 5 }] });
  fireEvent.click(screen.getByRole("button", { name: "Importar PDF de prueba" }));
  expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveValue("15");
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  expect(upsertPurchase).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Ticket 1.*Total pagado: escribe/ }));
  await waitFor(() => expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveFocus());
  expect(screen.getByLabelText("Total pagado", { exact: true })).toHaveValue("");
});

it("#356 bulk creation initializes slug and a tracked zero shelf like the mini form", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar línea" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear 2 productos" }));
    await waitFor(() => expect(createDraftProductsForPurchase).toHaveBeenCalledTimes(1));
    const batch = createDraftProductsForPurchase.mock.calls[0][0] as Array<{ slug?: string; quantityOnHand?: number; sku?: string }>;
    expect(batch).toHaveLength(2);
    for (const created of batch) {
      // Same initialization the mini form got in 1.15.1: public route + tracked
      // zero shelf — never a blank-inventory ficha.
      expect(typeof created.slug).toBe("string");
      expect(created.slug!.length).toBeGreaterThan(0);
      expect(created.quantityOnHand).toBe(0);
      expect(created.sku).toBeTruthy();
    }
  });

it("does not let bulk product creation persist an invalid amount hidden in another ticket", () => {
  open();
  fireEvent.change(screen.getByLabelText("Total pagado", { exact: true }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Agregar ticket" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Agregar línea" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Agregar línea" }));
  expect(screen.getByRole("button", { name: "Crear 2 productos" })).toBeDisabled();
});

it("locks adding and removing trip expenses while a draft save is pending", async () => {
  let finish!: () => void;
  upsertPurchase.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  open({ ...purchase(), sourcingExpenses: [{ id: "transport", category: "sourcing_transport", amount: 44 }] });
  fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  expect(screen.getByRole("button", { name: "+ Agregar gasto" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /^Quitar$/ })).toBeDisabled();
  finish();
  await waitFor(() => expect(screen.getByRole("button", { name: "+ Agregar gasto" })).not.toBeDisabled());
  expect(upsertPurchase.mock.calls[0][0].sourcingExpenses).toEqual([{ id: "transport", category: "sourcing_transport", amount: 44 }]);
});

it("does not replace an invalid captured cost with zero through individual product creation", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Producto en Store OS" }), { target: { value: "Nueva pieza" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Crear nuevo producto" }));
  expect(screen.queryByRole("dialog", { name: "Nuevo producto" })).not.toBeInTheDocument();
  expect(upsertProduct).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText("Costo unitario")).toHaveFocus());
  expect(screen.getByLabelText("Costo unitario")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Costo unitario"), { target: { value: "16.45" } });
  fireEvent.focus(screen.getByRole("combobox", { name: "Producto en Store OS" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Crear nuevo producto" }));
  expect(screen.getByRole("dialog", { name: "Nuevo producto" })).toBeVisible();
  expect(screen.getByLabelText("Costo", { exact: true })).toHaveValue("16.45");
});

describe("ticket code preservation (PO report in #206)", () => {
  const ticketPurchase = (): Purchase => ({
    ...purchase(),
    lines: [{ lineId: "line", productId: "", name: "123-ABC", quantity: 2, unitCost: 80 }],
    subtotal: 160, totalConfirmed: 160,
  });

  it("keeps the ticket code when linking an existing product with a different name and cost", async () => {
    open(ticketPurchase());
    const search = screen.getByRole("combobox", { name: "Producto en Store OS" });
    fireEvent.change(search, { target: { value: "Anillo" } });
    fireEvent.click(screen.getByRole("option", { name: /Anillo/ }));
    expect(screen.getByLabelText("Producto del ticket")).toHaveValue("123-ABC");
    expect(screen.getByLabelText("Costo unitario")).toHaveValue("80");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0]).toMatchObject({ productId: "ring", name: "123-ABC", unitCost: 80 });
  });

  it.each([false, true])("creates a complete product without overwriting the ticket when publishing is %s", async (publish) => {
    open(ticketPurchase());
    fireEvent.focus(screen.getByRole("combobox", { name: "Producto en Store OS" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Crear nuevo producto" }));
    const sheet = screen.getByRole("dialog", { name: "Nuevo producto" });
    expect(screen.getByLabelText("Nombre")).toHaveValue("123-ABC"); // prefill from the line
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Aretes Dorados" } });
    fireEvent.change(screen.getByLabelText("Costo", { exact: true }), { target: { value: "120" } });
    if (publish) fireEvent.click(within(sheet).getByRole("checkbox", { name: /^Publicar en el catálogo/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledOnce());
    expect(upsertProduct.mock.calls[0][0]).toMatchObject({
      name: "Aretes Dorados", slug: "aretes-dorados", quantityOnHand: 0,
      status: publish ? "published" : "draft", isPublic: publish,
    });
    expect(screen.getByLabelText("Producto del ticket")).toHaveValue("123-ABC");
    expect(screen.getByLabelText("Costo unitario")).toHaveValue("80");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0]).toMatchObject({ name: "123-ABC", unitCost: 80 });
    expect(upsertPurchase.mock.calls[0][0].lines[0].productId).toBeTruthy();
  });

  it("prefills the ticket field from the product only when the line has no text", async () => {
    const value = ticketPurchase();
    value.lines[0] = { ...value.lines[0], name: "" };
    open(value);
    const search = screen.getByRole("combobox", { name: "Producto en Store OS" });
    fireEvent.change(search, { target: { value: "Anillo" } });
    fireEvent.click(screen.getByRole("option", { name: /Anillo/ }));
    expect(screen.getByLabelText("Producto del ticket")).toHaveValue("Anillo");
  });

  it("unlinking keeps the captured ticket text", async () => {
    open(ticketPurchase());
    const search = screen.getByRole("combobox", { name: "Producto en Store OS" });
    fireEvent.change(search, { target: { value: "Anillo" } });
    fireEvent.click(screen.getByRole("option", { name: /Anillo/ }));
    expect(screen.getByLabelText("Producto del ticket")).toHaveValue("123-ABC");
    fireEvent.change(search, { target: { value: "" } }); // clear → unlink
    expect(screen.getByLabelText("Producto del ticket")).toHaveValue("123-ABC");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][0].lines[0]).toMatchObject({ productId: "", name: "123-ABC" });
  });
});

describe("#373 revisión de compras en el formulario", () => {
  it("un guardado rechazado por revisión vencida se explica en pantalla y el formulario sigue abierto", async () => {
    open();
    upsertPurchase.mockRejectedValueOnce(new StalePurchaseError());
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText("La compra cambió en otra pestaña o dispositivo. Vuelve a abrirla antes de guardar.")).toBeVisible();
    // Nada de éxito falso: el editor permanece con la captura.
    expect(screen.queryByText("Borrador guardado.")).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();
  });

  it("el segundo guardado usa la revisión devuelta y viaja con el baseline de gastos", async () => {
    open();
    upsertPurchase.mockClear();
    upsertPurchase.mockResolvedValueOnce({ ...purchase(), revision: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    expect(upsertPurchase.mock.calls[0][1]).toBeNull(); // carga inicial sin revisión
    expect(upsertPurchase.mock.calls[0][2]).toMatchObject({ id: "purchase" }); // baseline = lo cargado

    upsertPurchase.mockResolvedValueOnce({ ...purchase(), revision: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledTimes(2));
    expect(upsertPurchase.mock.calls[1][1]).toBe(1); // la revisión viva del primer guardado
    expect(await screen.findByText("Borrador guardado.")).toBeVisible();
  });
});

describe("#373 r2 — baseline avanza con cada guardado (no duplica gastos)", () => {
  const e1 = { id: "e1", category: "sourcing_transport" as const, amount: 44 };

  function purchaseWithExpenses(): Purchase {
    return {
      id: "baseline-order", storeId: "olivia", date: "2026-11-14", status: "draft",
      lines: [{ lineId: "l0", ticketId: "t1", productId: "", name: "Pieza", quantity: 1, unitCost: 10 }],
      tickets: [{ id: "t1", supplierId: "sup1", supplierName: "Prov", totalConfirmed: 0 }],
      sourcingExpenses: [e1],
      subtotal: 0, totalConfirmed: 0, createdAt: "", updatedAt: "",
    };
  }

  it("editar un gasto y volver a guardar en la MISMA sesión no re-anexa el gasto como concurrente", async () => {
    open(purchaseWithExpenses());
    // Primer guardado: el doc ya tenía e1; el baseline de apertura también.
    upsertPurchase.mockResolvedValueOnce({ ...purchaseWithExpenses(), revision: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    // El baseline del PRIMER guardado incluye e1 (la prop de apertura).
    expect(upsertPurchase.mock.calls[0][2]).toMatchObject({ sourcingExpenses: [e1] });
    // Segundo guardado SIN cambios: el baseline debe seguir incluyendo e1
    // (avanzó con lo guardado), no tratarlo como asignación concurrente.
    upsertPurchase.mockResolvedValueOnce({ ...purchaseWithExpenses(), revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledTimes(2));
    const baseline2 = upsertPurchase.mock.calls[1][2];
    expect(baseline2).toMatchObject({ sourcingExpenses: [e1] });
  });

  it("agregar un gasto, guardar y volver a guardar tampoco duplica", async () => {
    open({ ...purchaseWithExpenses(), sourcingExpenses: [] });
    fireEvent.click(screen.getByRole("tab", { name: "Revisión general" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar gasto" }));
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "44" } });
    const saved1 = { ...purchaseWithExpenses(), revision: 2 };
    upsertPurchase.mockResolvedValueOnce(saved1);
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledOnce());
    upsertPurchase.mockResolvedValueOnce({ ...saved1, revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(upsertPurchase).toHaveBeenCalledTimes(2));
    const baseline2 = upsertPurchase.mock.calls[1][2];
    // El baseline avanzó: el gasto guardado ya es «conocido», no concurrente.
    expect(baseline2).toMatchObject({ sourcingExpenses: [e1] });
  });
});
