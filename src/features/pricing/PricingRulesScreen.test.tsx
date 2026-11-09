// @vitest-environment jsdom
// #254 — Reglas de venta: configure per-level rules, see suggestions, and
// apply them explicitly — saving rules never changes a price by itself.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PricingRulesScreen } from "./PricingRulesScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Product, Store } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  savePricingRules: vi.fn(),
  upsertProduct: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      savePricingRules: mocks.savePricingRules,
      upsertProduct: mocks.upsertProduct,
    }),
  };
});

function oliviaStore(): Store {
  const store = { ...mocks.state!.stores[0] } as Store;
  store.priceTiers = [
    { id: "t_iconic", label: "Iconic", order: 1 },
    { id: "t_retail", label: "Regular", order: 2 },
  ];
  store.defaultTierId = "t_iconic";
  return store;
}

function product(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    storeId: "store_olivia",
    name: "Huggies Mezcalita Gold",
    category: "other",
    isPublic: true,
    status: "published",
    cost: 100,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as Product;
}

let state: ReturnType<typeof fixtureState>;

beforeEach(() => {
  state = fixtureState();
  mocks.state = state;
  state.stores[0] = oliviaStore();
  mocks.savePricingRules.mockReset();
  mocks.savePricingRules.mockResolvedValue(undefined);
  mocks.upsertProduct.mockReset();
  mocks.upsertProduct.mockResolvedValue(undefined);
});

describe("PricingRulesScreen (#254)", () => {
  it("configura un porcentaje por nivel y guarda vía savePricingRules", async () => {
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    const percent = screen.getAllByLabelText(/Porcentaje sobre el costo/)[0];
    fireEvent.change(percent, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar reglas/ }));
    expect(await screen.findByText("Reglas de venta guardadas.")).toBeTruthy();
    expect(mocks.savePricingRules).toHaveBeenCalledTimes(1);
    const saved = mocks.savePricingRules.mock.calls[0][0];
    expect(saved.byTier.t_iconic).toEqual({ kind: "markup", percent: 200, rounding: "none" });
  });

  it("muestra sugerencias por producto y aplicar seleccionados escribe precios vía upsertProduct", async () => {
    state.products = [product({ prices: { t_iconic: 60, t_retail: 130 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    fireEvent.change(screen.getAllByLabelText(/Porcentaje sobre el costo/)[0], { target: { value: "200" } });
    // costo $100 + 200% → sugerido Iconic $300 (vs actual $60)
    expect((await screen.findAllByText(/\$300/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/Precios actualizados en 1 producto/)).toBeTruthy();
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(1);
    const updated = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(updated.prices).toEqual({ t_iconic: 300, t_retail: 130 });
  });

  it("bandas inválidas (precio 0) bloquean el guardado", async () => {
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    fireEvent.change(screen.getAllByLabelText("Método")[0], { target: { value: "bands" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar reglas/ }));
    expect((await screen.findAllByText(/Cada banda necesita un precio mayor que cero/)).length).toBeGreaterThan(0);
    expect(mocks.savePricingRules).not.toHaveBeenCalled();
  });

  it("#280 P0-1: una sugerencia bajo el costo base NO se aplica (regla general)", async () => {
    state.stores[0].pricingRules = {
      byTier: { t_iconic: { kind: "bands", bands: [{ min: 0, price: 60 }], rounding: "none" } },
    };
    state.products = [product({ cost: 100, prices: { t_iconic: 120 } })]; // sugerido 60 < costo base 100
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/bajo el costo/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/Solo había precios sugeridos bajo el costo/)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("#280 P0-1: la excepción EXPLÍCITA por producto sí puede quedar bajo el costo", async () => {
    state.stores[0].pricingRules = {
      byTier: {},
      byProduct: { p1: { t_iconic: { kind: "bands", bands: [{ min: 0, price: 60 }], rounding: "none" } } },
    };
    state.products = [product({ cost: 100, prices: { t_iconic: 120 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    await screen.findAllByText(/\$60/);
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/Precios actualizados en 1 producto/)).toBeTruthy();
    const updated = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(updated.prices?.t_iconic).toBe(60); // decisión deliberada de Fer vía excepción
  });

  it("guardar reglas NO cambia precios: sin selección, aplicar no llama a upsertProduct", async () => {
    state.products = [product({ prices: { t_iconic: 60 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    fireEvent.change(screen.getAllByLabelText(/Porcentaje sobre el costo/)[0], { target: { value: "200" } });
    const apply = screen.getByRole("button", { name: /Aplicar seleccionados/ });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });
});
