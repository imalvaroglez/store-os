// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../design-system";
import type { Product } from "../../types";
import { ProductConversionSheet, MergedIntoLink } from "./ProductConversionSheet";

const convertProductVariants = vi.fn().mockResolvedValue(undefined);

const { state, activeStore } = vi.hoisted(() => {
  const product = (id: string, overrides: Partial<Product> = {}): Product => ({
    id, storeId: "s1", name: `Ficha ${id}`, sku: `SKU-${id}`, category: "jewelry", isPublic: true, status: "published",
    cost: 100, quantityOnHand: 2, createdAt: "", updatedAt: "",
    ...overrides,
  } as Product);
  const main: Product = {
    ...product("main", { name: "Anillo Sol" }),
    variants: [{ id: "v_dorado", color: "Dorado", skuSuffix: "D", sku: "SOL-D", photos: [], createdAt: "", updatedAt: "",
      sizes: [{ id: "s6", size: "6", sku: "SOL-D-6", cost: 110, quantityOnHand: 5, createdAt: "", updatedAt: "" }] }],
  };
  return {
    activeStore: { id: "s1", name: "Tienda", type: "inventory_tiered" as const },
    state: {
      products: [
        main,
        product("o1", { name: "Anillo Sol Dorado 7", sku: "SOL-X-7", quantityOnHand: 3 }),
        product("o2", { name: "Anillo Sol Plateado 9", sku: "SOL-X-9", quantityOnHand: 4 }),
        product("variantlike", { variants: [{ id: "v", color: "Rosa", photos: [], createdAt: "", updatedAt: "" }], quantityOnHand: 1 }),
        product("ya", { status: "archived", mergedInto: { productId: "main", variantId: "v_dorado", sizeId: "s6", at: "" } }),
      ],
      orders: [] as never[],
      purchases: [] as never[],
    },
  };
});

vi.mock("../../app/StoreProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../app/StoreProvider")>(),
  useStore: () => ({ state, activeStore, convertProductVariants }),
}));

function openSheet() {
  render(<ToastProvider><ProductConversionSheet open onClose={() => undefined} /></ToastProvider>);
}

describe("#461 hoja de conversión asistida", () => {
  beforeEach(() => { convertProductVariants.mockClear().mockResolvedValue(undefined); });

  it("el selector de orígenes excluye fichas con colores y ya fusionadas", async () => {
    openSheet();
    fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
    const originSelect = screen.getByLabelText(/Agregar ficha origen/) as HTMLSelectElement;
    const options = [...originSelect.querySelectorAll("option")].map((o) => o.value);
    expect(options).toContain("o1");
    expect(options).toContain("o2");
    expect(options).not.toContain("variantlike");
    expect(options).not.toContain("ya");
  });

  it("la vista previa muestra antes/después y el confirmar llama con el mapeo y la existencia vista", async () => {
    openSheet();
    fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o1" } });
    await screen.findByText(/Anillo Sol Dorado 7/);
    fireEvent.change(screen.getByLabelText(/Talla de la combinación/), { target: { value: "7" } });
    expect(screen.getByText("Físico antes").parentElement?.textContent).toContain("3");
    expect(screen.getByText("En la combinación").parentElement?.textContent).toContain("3");
    fireEvent.click(screen.getByRole("button", { name: "Unificar fichas" }));
    await waitFor(() => expect(convertProductVariants).toHaveBeenCalledOnce());
    expect(convertProductVariants.mock.calls[0][0]).toEqual({
      mainId: "main",
      mappings: [{ productId: "o1", color: "Dorado", size: "7" }],
      expected: { o1: { physical: 3, quarantine: 0 } },
    });
  });

  it("un pedido pendiente bloquea con su motivo y el confirmar queda deshabilitado", async () => {
    // pending order holding o2 pieces — pushed into the shared store state
    const holding = { id: "ord-1", storeId: "s1", status: "confirmed", installmentsReservedAt: "2026-11-22T00:00:00.000Z", items: [{ productId: "o2", productName: "X", quantity: 2, unitPrice: 1, subtotal: 2 }] } as never;
    state.orders.push(holding);
    try {
      openSheet();
      fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
      fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o2" } });
      await screen.findByText(/Resuelve esto antes de unificar/);
      expect(screen.getByText(/por entregar/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Unificar fichas" })).toBeDisabled();
      expect(convertProductVariants).not.toHaveBeenCalled();
    } finally {
      state.orders.pop();
    }
  });

  it("cancelar no toca nada", async () => {
    openSheet();
    fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o1" } });
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(convertProductVariants).not.toHaveBeenCalled();
  });

  it("MergedIntoLink enlaza a la ficha unificada", () => {
    const onOpen = vi.fn();
    render(<MergedIntoLink product={state.products[4]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /ver diseño unificado/i }));
    expect(onOpen).toHaveBeenCalledWith("main");
  });
});
