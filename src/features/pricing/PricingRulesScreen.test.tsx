// @vitest-environment jsdom
// #254 — Reglas de venta: configure per-level rules, see suggestions, and
// apply them explicitly — saving rules never changes a price by itself.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PricingRulesScreen } from "./PricingRulesScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import type { Product, Store, PricingRulesConfig } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  savePricingRules: vi.fn(),
  upsertProduct: vi.fn(),
  applyProductPrices: vi.fn(),
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
      applyProductPrices: mocks.applyProductPrices,
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
    quantityOnHand: 1,
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
  mocks.applyProductPrices.mockReset();
  mocks.applyProductPrices.mockResolvedValue(undefined);
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

  it("muestra sugerencias y aplicar pasa por el resumen y escribe SOLO precios (applyProductPrices)", async () => {
    state.products = [product({ prices: { t_iconic: 60, t_retail: 130 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    fireEvent.change(screen.getAllByLabelText(/Porcentaje sobre el costo/)[0], { target: { value: "200" } });
    // costo $100 + 200% → sugerido Iconic $300 (vs actual $60)
    expect((await screen.findAllByText(/\$300/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    // Resumen antes de escribir (#289).
    expect(await screen.findByText(/Aplicar precios a 1 pieza/)).toBeTruthy();
    expect(screen.getByText(/1 subirían/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Aplicar 1 precio/ }));
    expect(await screen.findByText(/Precios actualizados en 1 pieza/)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    expect(mocks.applyProductPrices).toHaveBeenCalledTimes(1);
    const updates = mocks.applyProductPrices.mock.calls[0][0];
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0])).toEqual(["id", "prices"]); // escritura acotada
    expect(updates[0].prices).toEqual({ t_iconic: 300, t_retail: 130 });
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
    expect(await screen.findByText(/se omite \(excepción de Fer requerida\)/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/Solo había precios sugeridos bajo el costo/)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("#280 P0-1: la excepción por producto bajo el costo exige confirmación EN EL MOMENTO (PO 2026-11-09)", async () => {
    state.stores[0].pricingRules = {
      byTier: {},
      byProduct: { p1: { t_iconic: { kind: "bands", bands: [{ min: 0, price: 60 }], rounding: "none" } } },
    };
    state.products = [product({ cost: 100, prices: { t_iconic: 120 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    await screen.findAllByText(/\$60/);
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    // Resumen primero, luego la confirmación de pérdida (#289).
    expect(await screen.findByText(/Aplicar precios a 1 pieza/)).toBeTruthy();
    expect(screen.getByText(/1 precio\(s\) bajo el costo por excepciones/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    // Una excepción previa NO es autorización vigente: pide confirmación explícita.
    expect(await screen.findByText(/1 precio\(s\) bajo el costo/)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    // Cancelar no aplica nada.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    // Reintentar y confirmar la pérdida deliberada.
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/Aplicar precios a 1 pieza/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: /Aplicar todo/ }));
    expect(await screen.findByText(/Precios actualizados en 1 pieza/)).toBeTruthy();
    const updates = mocks.applyProductPrices.mock.calls[0][0];
    expect(updates[0].prices.t_iconic).toBe(60); // decisión deliberada y confirmada de Fer
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("#280 P0-1: en el diálogo bajo costo se puede aplicar solo lo seguro", async () => {
    state.stores[0].pricingRules = {
      byTier: { t_retail: { kind: "fixed", amount: 60, rounding: "none" } }, // 100+60=160 seguro
      byProduct: { p1: { t_iconic: { kind: "bands", bands: [{ min: 0, price: 60 }], rounding: "none" } } },
    };
    state.products = [product({ cost: 100, prices: { t_iconic: 120, t_retail: 200 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    await screen.findAllByText(/\$160/);
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/Aplicar precios a 1 pieza/)).toBeTruthy();
    expect(screen.getByText(/1 bajarían/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText(/1 precio\(s\) bajo el costo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Aplicar sin esos 1/ }));
    expect(await screen.findByText(/se omitieron 1 por quedar bajo el costo/)).toBeTruthy();
    const updates = mocks.applyProductPrices.mock.calls[0][0];
    expect(updates[0].prices.t_retail).toBe(160); // el cambio seguro sí entró
    expect(updates[0].prices.t_iconic).toBe(120); // el bajo costo quedó intacto
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
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

describe("PricingRulesScreen orientación y lote (#289)", () => {
  it("sin reglas ni tablas: banner que guía a Estrategia y error que lo explica", async () => {
    state.products = [product({ prices: { t_iconic: 60 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(screen.getByText("Todavía no hay reglas ni tablas de precios")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir a Estrategia de precios" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Huggies Mezcalita Gold"));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    expect(await screen.findByText(/aún no hay reglas ni tablas/)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("con tablas: Seleccionar elegibles marca las piezas con cambios y aplicarlas en un toque", async () => {
    state.stores[0].pricingRules = {
      byTier: { t_iconic: { kind: "markup", percent: 100, rounding: "none" } }, // costo 100 → 200
    };
    state.products = [product({ id: "p1", cost: 100, prices: { t_iconic: 60 } }), product({ id: "p2", cost: 100, prices: { t_iconic: 200 } })];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    const selectAll = await screen.findByRole("button", { name: /Seleccionar elegibles \(1\)/ });
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Aplicar 1 precio/ }));
    expect(await screen.findByText(/Precios actualizados en 1 pieza/)).toBeTruthy();
    expect(mocks.applyProductPrices).toHaveBeenCalledTimes(1);
    expect(mocks.applyProductPrices.mock.calls[0][0][0].prices.t_iconic).toBe(200);
  });
});

describe("#289 misión 5a — config sin byTier (regresión)", () => {
  it("una tienda que empieza precios por Estrategia (solo byCategory) renderiza y sugiere por tabla", async () => {
    state.categories = [
      { id: "c_reloj", storeId: "store_olivia", name: "Reloj", active: true, createdAt: "", updatedAt: "" },
    ] as typeof state.categories;
    state.stores[0].pricingRules = {
      byCategory: { c_reloj: { t_iconic: { kind: "bands", bands: [{ min: 0, price: 90 }], rounding: "none" } } },
    } as PricingRulesConfig;
    state.products = [
      product({ id: "p1", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 40, prices: { t_iconic: 60 } }),
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    // Antes del fix de tipo+guardas: "Cannot convert undefined or null to
    // object" (Object.entries/Object.keys sobre byTier ausente).
    expect(await screen.findByText(/Reloj Madrid/)).toBeTruthy();
    expect(screen.getAllByText(/\$90/).length).toBeGreaterThan(0);
  });
});
