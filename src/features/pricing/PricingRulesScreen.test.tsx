// @vitest-environment jsdom
// #254 — Reglas de venta: configure per-level rules, see suggestions, and
// apply them explicitly — saving rules never changes a price by itself.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PricingRulesScreen } from "./PricingRulesScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import { setSuggestionsFocus, takeSuggestionsFocus } from "./suggestionsFocus";
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
    // Una excepción previa NO es autorización vigente: pide confirmación explícita.
    expect(await screen.findByText(/1 precio\(s\) bajo el costo/)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    // Cancelar no aplica nada.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    // Reintentar y confirmar la pérdida deliberada.
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Aplicar todo/ }));
    expect(await screen.findByText(/Precios actualizados en 1 producto/)).toBeTruthy();
    const updated = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(updated.prices?.t_iconic).toBe(60); // decisión deliberada y confirmada de Fer
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
    expect(await screen.findByText(/1 precio\(s\) bajo el costo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Aplicar sin esos 1/ }));
    expect(await screen.findByText(/se omitieron 1 precio\(s\) por quedar bajo el costo/)).toBeTruthy();
    const updated = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(updated.prices?.t_retail).toBe(160); // el cambio seguro sí entró
    expect(updated.prices?.t_iconic).toBe(120); // el bajo costo quedó intacto
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

describe("PricingRulesScreen #289 — orientación, filtro y selección masiva", () => {
  function withCategories() {
    state.categories = [
      { id: "c_reloj", storeId: "store_olivia", name: "Reloj", active: true, createdAt: "", updatedAt: "" },
      { id: "c_aretes", storeId: "store_olivia", name: "Aretes", active: true, createdAt: "", updatedAt: "" },
    ] as typeof state.categories;
  }

  it("sin reglas ni tablas ni excepciones: explica qué falta y lleva directo a Estrategia", async () => {
    state.products = [product({})];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/Aún no hay reglas ni tablas de precios/)).toBeTruthy();
    const go = screen.getByRole("button", { name: "Ir a Estrategia de precios" });
    expect(go).toBeTruthy();
    // La pared de filas sin sentido no existe en este estado.
    expect(screen.queryByLabelText("Categoría")).toBeNull();
  });

  it("muestra el filtro por categoría, el conteo honesto y la etiqueta opcional de las reglas generales", async () => {
    withCategories();
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [
      product({ id: "p_reloj", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 60 } }),
      product({ id: "p_aretes", name: "Aretes Luna", categoryIds: ["c_aretes"], cost: 100, prices: { t_iconic: 300 } }),
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/2 piezas mostradas · 1 con cambios/)).toBeTruthy();
    // Regla general etiquetada como fallback opcional.
    expect(screen.getAllByText(/Opcional: se usa cuando una pieza no tiene tabla/).length).toBeGreaterThan(0);
    // Filtrar conserva el contexto: solo la categoría elegida.
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c_aretes" } });
    expect(await screen.findByText(/1 pieza mostrada · 0 con cambios/)).toBeTruthy();
    expect(screen.queryByLabelText("Reloj Madrid")).toBeNull();
  });

  it("Seleccionar todo marca exactamente las piezas con cambios del filtro; Limpiar desmarca", async () => {
    withCategories();
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [
      product({ id: "p1", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 60 } }),
      product({ id: "p2", name: "Reloj Génova", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 300 } }), // sin cambios
      product({ id: "p3", name: "Aretes Luna", categoryIds: ["c_aretes"], cost: 100, prices: { t_iconic: 60 } }),
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/3 piezas mostradas · 2 con cambios/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Seleccionar todo \(2 con cambios\)/ }));
    expect((screen.getByLabelText("Reloj Madrid") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Aretes Luna") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Reloj Génova") as HTMLInputElement).checked).toBe(false);
    // Aplicar seleccionados por lote: 2 precios escritos.
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados \(2\)/ }));
    expect(await screen.findByText(/Precios actualizados en 2 producto/)).toBeTruthy();
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(2);
    // La selección quedó limpia tras aplicar; el botón de limpiar ya no aparece.
    expect(screen.queryByRole("button", { name: /Limpiar selección/ })).toBeNull();
  });

  it("el filtro respeta la selección masiva: seleccionar dentro de una categoría no toca las demás", async () => {
    withCategories();
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [
      product({ id: "p1", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 60 } }),
      product({ id: "p3", name: "Aretes Luna", categoryIds: ["c_aretes"], cost: 100, prices: { t_iconic: 60 } }),
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/2 piezas mostradas · 2 con cambios/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c_reloj" } });
    expect(await screen.findByText(/1 pieza mostrada · 1 con cambios/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Seleccionar todo \(1 con cambios\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Limpiar selección/ }));
    expect((screen.getByLabelText("Reloj Madrid") as HTMLInputElement).checked).toBe(false);
  });

  it("volumen: 120 piezas en 3 categorías; el escenario del PO se resuelve sin recorrer el catálogo", async () => {
    withCategories();
    state.categories.push({ id: "c_anillos", storeId: "store_olivia", name: "Anillos", active: true, createdAt: "", updatedAt: "" } as typeof state.categories[number]);
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = Array.from({ length: 120 }, (_, i) =>
      product({
        id: `p${i}`,
        name: `Pieza ${i}`,
        categoryIds: [i < 40 ? "c_reloj" : i < 80 ? "c_aretes" : "c_anillos"],
        cost: 100,
        prices: { t_iconic: 60 }, // todas cambiarían con +200%
      })
    );
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/120 piezas mostradas · 120 con cambios/, {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c_reloj" } });
    expect(await screen.findByText(/40 piezas mostradas · 40 con cambios/, {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Seleccionar todo \(40 con cambios\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados \(40\)/ }));
    expect(await screen.findByText(/Precios actualizados en 40 producto/)).toBeTruthy();
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(40);
    // Solo la categoría filtrada: las otras 80 intactas.
    const updatedIds = mocks.upsertProduct.mock.calls.map((c) => (c[0] as Product).id);
    expect(updatedIds.every((id) => Number(id.slice(1)) < 40)).toBe(true);
  });

  it("abre con la categoría entregada por Estrategia (traspaso de foco)", async () => {
    withCategories();
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [
      product({ id: "p1", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 60 } }),
      product({ id: "p3", name: "Aretes Luna", categoryIds: ["c_aretes"], cost: 100, prices: { t_iconic: 60 } }),
    ];
    setSuggestionsFocus("c_reloj");
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/1 pieza mostrada · 1 con cambios/)).toBeTruthy();
    expect(screen.queryByLabelText("Aretes Luna")).toBeNull();
    // El foco es de un solo uso: un segundo montaje arranca sin filtro.
    expect(takeSuggestionsFocus()).toBeNull();
  });

  it("aplicar sin cambios posibles explica qué hacer en vez de confundir", async () => {
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [product({ cost: 100, prices: { t_iconic: 300 } })]; // sugerido == actual
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/1 pieza mostrada · 0 con cambios/)).toBeTruthy();
    // Sin cambios no hay nada seleccionable: el botón de seleccionar todo lo dice.
    expect(screen.getByRole("button", { name: /Seleccionar todo \(0 con cambios\)/ })).toHaveProperty("disabled", true);
  });
});

describe("PricingRulesScreen #289 — hallazgos de revisión", () => {
  function withCategories() {
    state.categories = [
      { id: "c_reloj", storeId: "store_olivia", name: "Reloj", active: true, createdAt: "", updatedAt: "" },
      { id: "c_aretes", storeId: "store_olivia", name: "Aretes", active: true, createdAt: "", updatedAt: "" },
    ] as typeof state.categories;
  }

  it("Seleccionar todo conserva una selección manual de otra categoría (unión, no reemplazo)", async () => {
    withCategories();
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [
      product({ id: "p1", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 60 } }),
      product({ id: "p2", name: "Reloj Génova", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 300 } }), // sin cambios
      product({ id: "p3", name: "Aretes Luna", categoryIds: ["c_aretes"], cost: 100, prices: { t_iconic: 60 } }),
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/3 piezas mostradas · 2 con cambios/)).toBeTruthy();
    // Selección manual previa de otra categoría.
    fireEvent.click(screen.getByLabelText("Aretes Luna"));
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c_reloj" } });
    expect(await screen.findByText(/2 piezas mostradas · 1 con cambios/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Seleccionar todo \(1 con cambios\)/ }));
    expect((screen.getByLabelText("Reloj Madrid") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Reloj Génova") as HTMLInputElement).checked).toBe(false);
    // La manual de otra categoría sobrevive: al volver a Todas sigue marcada…
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "" } });
    expect((await screen.findByLabelText("Aretes Luna") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Reloj Génova") as HTMLInputElement).checked).toBe(false);
    // …y el botón refleja la unión completa.
    expect(screen.getByRole("button", { name: /Aplicar seleccionados \(2\)/ })).toBeTruthy();
  });

  it("selección masiva con piezas solo-bajo-costo: no se escriben y el reporte lo dice", async () => {
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "bands", bands: [{ min: 0, price: 60 }], rounding: "none" } } };
    state.products = [
      product({ id: "p1", name: "Pieza Segura", cost: 50, prices: { t_iconic: 100 } }), // 60 > 50: aplica
      product({ id: "p2", name: "Pieza Bajo Costo", cost: 100, prices: { t_iconic: 120 } }), // 60 < 100: omitida
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/2 piezas mostradas · 2 con cambios/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Seleccionar todo \(2 con cambios\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Aplicar seleccionados \(2\)/ }));
    expect(await screen.findByText(/Se aplicaron precios de 1 producto/)).toBeTruthy();
    expect(await screen.findByText(/se omitieron 1 precio\(s\) por quedar bajo el costo/)).toBeTruthy();
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(1);
    expect((mocks.upsertProduct.mock.calls[0][0] as Product).name).toBe("Pieza Segura");
  });

  it("piezas sin categoría solo aparecen en Todas; el filtro nunca las esconde del total", async () => {
    withCategories();
    state.stores[0].pricingRules = { byTier: { t_iconic: { kind: "markup", percent: 200, rounding: "none" } } };
    state.products = [
      product({ id: "p1", name: "Reloj Madrid", categoryIds: ["c_reloj"], cost: 100, prices: { t_iconic: 60 } }),
      product({ id: "p0", name: "Pieza Huérfana", cost: 100, prices: { t_iconic: 60 } }), // sin categoryIds
    ];
    render(<ToastProvider><PricingRulesScreen /></ToastProvider>);
    expect(await screen.findByText(/2 piezas mostradas · 2 con cambios/)).toBeTruthy();
    expect(screen.getByLabelText("Pieza Huérfana")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "c_reloj" } });
    expect(await screen.findByText(/1 pieza mostrada · 1 con cambios/)).toBeTruthy();
    expect(screen.queryByLabelText("Pieza Huérfana")).toBeNull();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "" } });
    expect(await screen.findByLabelText("Pieza Huérfana")).toBeTruthy();
  });
});
