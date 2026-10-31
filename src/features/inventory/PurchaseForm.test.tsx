// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import type { Purchase } from "../../types";
import { PurchaseForm } from "./PurchaseForm";

const { upsertPurchase, upsertProduct, activeStore, state } = vi.hoisted(() => ({
  upsertPurchase: vi.fn().mockResolvedValue(undefined),
  upsertProduct: vi.fn().mockResolvedValue(undefined),
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
  useStore: () => ({ state, activeStore, upsertPurchase, upsertProduct, cloud: true }),
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

beforeEach(() => { upsertPurchase.mockClear(); upsertProduct.mockReset().mockResolvedValue(undefined); });

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
    expect(upsertPurchase.mock.calls[0][0]).toMatchObject({ discount: 0.5, shipping: 0.5, tax: 0.5, totalConfirmed: 0.5 });
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
});
