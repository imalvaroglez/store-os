// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    activeStore: {
      id: "s1", name: "Tienda", type: "inventory_tiered" as const,
      priceTiers: undefined as Array<{ id: string; label: string; order: number }> | undefined,
    },
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
    (await screen.findAllByText(/Anillo Sol Dorado 7/))[0];
    fireEvent.change(screen.getByLabelText(/Color del diseño/), { target: { value: "Dorado" } });
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

  // ── Dictamen QA 23-nov ──
  it("la talla NO se deduce del nombre y el color no se preselecciona a ciegas: ambos los elige Fer", async () => {
    openSheet();
    fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o1" } });
    (await screen.findAllByText(/Anillo Sol Dorado 7/))[0];
    expect((screen.getByLabelText(/Talla de la combinación/) as HTMLInputElement).value).toBe(""); // antes: «7» leído del nombre
    expect((screen.getByLabelText(/Color del diseño/) as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option", { name: "Elige el color…" })).toBeTruthy();
    expect(await screen.findByText(/Asigna color y talla de Anillo Sol Dorado 7/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unificar fichas" })).toBeDisabled();
  });

  it("el color se propone sólo cuando el acabado de la ficha origen nombra un color del diseño (revisable)", async () => {
    const originProduct = state.products[1];
    const pick = async () => {
      fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
      fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o1" } });
      (await screen.findAllByText(/Anillo Sol Dorado 7/))[0];
      return (screen.getByLabelText(/Color del diseño/) as HTMLSelectElement).value;
    };
    try {
      // Un acabado que no es color del diseño: no se propone nada.
      state.products[1] = { ...originProduct, finish: "Plateado" } as Product;
      openSheet();
      expect(await pick()).toBe("");
      cleanup();
      // Acabado «Dorado»: se propone ese color, siempre revisable.
      state.products[1] = { ...originProduct, finish: "Dorado" } as Product;
      openSheet();
      expect(await pick()).toBe("Dorado");
    } finally {
      state.products[1] = originProduct;
    }
  });

  it("mayor: precio distinto detiene la unificación, nombra ambas cifras y «Unificar» queda deshabilitado", async () => {
    const mainProduct = state.products[0];
    const originProduct = state.products[1];
    state.products[0] = { ...mainProduct, prices: { t_retail: 400 } } as Product;
    state.products[1] = { ...originProduct, prices: { t_retail: 450 } } as Product;
    activeStore.priceTiers = [{ id: "t_retail", label: "Regular", order: 1 }];
    try {
      openSheet();
      fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
      fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o1" } });
      fireEvent.change(screen.getByLabelText(/Color del diseño/), { target: { value: "Dorado" } });
      fireEvent.change(screen.getByLabelText(/Talla de la combinación/), { target: { value: "7" } });
      expect(await screen.findByText(/Anillo Sol Dorado 7 tiene precios distintos a los del diseño \(Regular: origen \$450 · color Dorado \$400\)/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Unificar fichas" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Unificar fichas" }));
      expect(convertProductVariants).not.toHaveBeenCalled();
    } finally {
      state.products[0] = mainProduct;
      state.products[1] = originProduct;
      activeStore.priceTiers = undefined;
    }
  });

  it("la vista previa muestra el Físico del diseño unificado antes y después", async () => {
    openSheet();
    fireEvent.change(screen.getByLabelText(/Diseño principal/), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText(/Agregar ficha origen/), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText(/Color del diseño/), { target: { value: "Dorado" } });
    fireEvent.change(screen.getByLabelText(/Talla de la combinación/), { target: { value: "7" } });
    // 5 del diseño + 3 del origen: la vista previa nunca esconde una pieza perdida.
    expect(
      await screen.findByText((_, element) => element?.tagName === "P" && element.textContent === "Físico del diseño unificado: antes 8 → después 8")
    ).toBeTruthy();
  });

  it("MergedIntoLink enlaza a la ficha unificada", () => {
    const onOpen = vi.fn();
    render(<MergedIntoLink product={state.products[4]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /ver diseño unificado/i }));
    expect(onOpen).toHaveBeenCalledWith("main");
  });
});
