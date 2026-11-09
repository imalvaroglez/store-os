// @vitest-environment jsdom
// #280 — Estrategia de precios: propose → edit → save ONE category's table.
// Critical guarantees from the PO: saving only touches this category's rules
// (never product prices), an incompatible existing config is never silently
// overwritten, pending prices block the save, and a concurrent change to the
// saved table surfaces a banner instead of clobbering the draft.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PricingStrategyScreen } from "./PricingStrategyScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import { CategoryRulesConflictError } from "../../app/StoreProvider";
import type { Category, Product, Store } from "../../types";

const mocks = vi.hoisted(() => ({
  state: null as ReturnType<typeof fixtureState> | null,
  saveCategoryPricingRules: vi.fn(),
  upsertProduct: vi.fn(),
}));

vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      activeStore: mocks.state?.stores.find((s) => s.id === mocks.state?.activeStoreId) ?? null,
      saveCategoryPricingRules: mocks.saveCategoryPricingRules,
      upsertProduct: mocks.upsertProduct,
    }),
  };
});

const CAT = "store_olivia__relojes";

function oliviaStore(): Store {
  const store = { ...mocks.state!.stores[0] } as Store;
  store.priceTiers = [
    { id: "t_retail", label: "Regular", order: 1 },
    { id: "t_girly", label: "Girly", order: 2 },
    { id: "t_iconic", label: "Iconic", order: 3 },
  ];
  store.defaultTierId = "t_retail";
  return store;
}

function categoryFixture(): Category {
  return {
    id: CAT,
    storeId: "store_olivia",
    name: "Relojes",
    slug: "relojes",
    sortOrder: 1,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as Category;
}

let counter = 0;
function product(cost: number, prices: Partial<Record<string, number>>, quantityOnHand = 1): Product {
  counter += 1;
  return {
    id: `p${counter}`,
    storeId: "store_olivia",
    name: `Reloj ${counter}`,
    category: "other",
    categoryIds: [CAT],
    isPublic: true,
    status: "published",
    cost,
    prices: prices as Record<string, number>,
    quantityOnHand,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as Product;
}

const cheap = { t_retail: 290, t_girly: 230, t_iconic: 160 };
const pricey = { t_retail: 310, t_girly: 260, t_iconic: 170 };

function clusterProducts(withIconic = true): Product[] {
  const c = withIconic ? cheap : { t_retail: cheap.t_retail, t_girly: cheap.t_girly };
  const p = withIconic ? pricey : { t_retail: pricey.t_retail, t_girly: pricey.t_girly };
  return [
    ...Array.from({ length: 8 }, () => product(20, c)),
    ...Array.from({ length: 4 }, () => product(22, c)),
    ...Array.from({ length: 8 }, () => product(95, p)),
  ];
}

let state: ReturnType<typeof fixtureState>;

function mount() {
  return render(
    <ToastProvider>
      <PricingStrategyScreen />
    </ToastProvider>
  );
}

function selectCategory() {
  fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: CAT } });
}

beforeEach(() => {
  state = fixtureState();
  mocks.state = state;
  state.stores[0] = oliviaStore();
  state.categories = [categoryFixture()];
  state.products = clusterProducts();
  mocks.saveCategoryPricingRules.mockReset();
  mocks.saveCategoryPricingRules.mockResolvedValue(undefined);
  mocks.upsertProduct.mockReset();
  mocks.upsertProduct.mockResolvedValue(undefined);
});

describe("PricingStrategyScreen (#280)", () => {
  it("propone, edita y guarda SOLO esta categoría: tres reglas bands con límites idénticos y ningún precio de producto", async () => {
    mount();
    selectCategory();
    expect(screen.getByText(/Elegidas 2 bandas|bandas:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar tabla/ }));
    expect(await screen.findByText("Tabla guardada. Los precios de tus productos no cambiaron.")).toBeTruthy();

    expect(mocks.saveCategoryPricingRules).toHaveBeenCalledTimes(1);
    const [categoryId, rules] = mocks.saveCategoryPricingRules.mock.calls[0];
    expect(categoryId).toBe(CAT);
    const limits = (Object.values(rules) as Array<{ bands: Array<{ min: number; max?: number }> }>).map((r) =>
      r.bands.map((b) => [b.min, b.max])
    );
    expect(new Set(limits.map((l) => JSON.stringify(l))).size).toBe(1);
    expect(limits[0]).toEqual([[0, 60], [60, undefined]]);
    expect((rules as Record<string, { bands: Array<{ price: number }> }>).t_iconic.bands[0].price).toBe(165);
    // Guardar la tabla jamás toca productos.
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("bloquea el guardado cuando un nivel quedó con precio pendiente", () => {
    state.products = clusterProducts(false);
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    expect(screen.getAllByText("Precio pendiente").length).toBeGreaterThan(0);
    const save = screen.getByRole("button", { name: /Guardar tabla|Sin cambios/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(mocks.saveCategoryPricingRules).not.toHaveBeenCalled();
  });

  it("muestra una config incompatible y solo la reemplaza con acción explícita", () => {
    state.stores[0].pricingRules = {
      byTier: {},
      byCategory: { [CAT]: { t_retail: { kind: "markup", percent: 120 } } },
    };
    mount();
    selectCategory();
    expect(screen.getByText(/este editor no puede mostrar/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Guardar tabla/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reemplazar con la propuesta/ }));
    expect(screen.getByRole("button", { name: /Guardar tabla|Sin cambios/ })).toBeTruthy();
  });

  it("carga una tabla guardada compatible, permite editarla y guardar de nuevo", async () => {
    state.stores[0].pricingRules = {
      byTier: {},
      byCategory: {
        [CAT]: {
          t_retail: { kind: "bands", bands: [{ min: 0, max: 60, price: 290 }, { min: 60, price: 310 }], rounding: "none" },
          t_girly: { kind: "bands", bands: [{ min: 0, max: 60, price: 230 }, { min: 60, price: 260 }], rounding: "none" },
          t_iconic: { kind: "bands", bands: [{ min: 0, max: 60, price: 160 }, { min: 60, price: 170 }], rounding: "none" },
        },
      },
    };
    mount();
    selectCategory();
    expect((screen.getAllByLabelText("Hasta $")[0] as HTMLInputElement).value).toBe("60");
    // Regression (e2e catch): every tier loads ITS OWN prices, not the first
    // tier's — Iconic must show 160, not Regular's 290.
    expect((screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement).value).toBe("160");
    fireEvent.change(screen.getAllByLabelText(/Regular \(pesos\)/)[0], { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar tabla/ }));
    expect(await screen.findByText("Tabla guardada. Los precios de tus productos no cambiaron.")).toBeTruthy();
    const [, rules] = mocks.saveCategoryPricingRules.mock.calls[0];
    expect((rules as Record<string, { bands: Array<{ price: number }> }>).t_retail.bands[0].price).toBe(300);
  });

  it("detecta cambios concurrentes de otra sesión sin sobrescribir el draft", () => {
    state.stores[0].pricingRules = {
      byTier: {},
      byCategory: {
        [CAT]: {
          t_retail: { kind: "bands", bands: [{ min: 0, max: 60, price: 290 }, { min: 60, price: 310 }], rounding: "none" },
          t_girly: { kind: "bands", bands: [{ min: 0, max: 60, price: 230 }, { min: 60, price: 260 }], rounding: "none" },
          t_iconic: { kind: "bands", bands: [{ min: 0, max: 60, price: 160 }, { min: 60, price: 170 }], rounding: "none" },
        },
      },
    };
    const view = mount();
    selectCategory();
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    // Another session saves a different table under our feet.
    const other = fixtureState();
    other.stores[0] = oliviaStore();
    other.stores[0].pricingRules = {
      byTier: {},
      byCategory: {
        [CAT]: {
          t_retail: { kind: "bands", bands: [{ min: 0, max: 50, price: 280 }, { min: 50, price: 300 }], rounding: "none" },
          t_girly: { kind: "bands", bands: [{ min: 0, max: 50, price: 220 }, { min: 50, price: 250 }], rounding: "none" },
          t_iconic: { kind: "bands", bands: [{ min: 0, max: 50, price: 150 }, { min: 50, price: 160 }], rounding: "none" },
        },
      },
    };
    mocks.state = other;
    view.rerender(
      <ToastProvider>
        <PricingStrategyScreen />
      </ToastProvider>
    );
    expect(screen.getByText(/cambiaron en otra sesión/i)).toBeTruthy();
    expect((screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement).value).toBe("165");
  });

  it("P0-2: un guardado concurrente de la MISMA categoría se rechaza, sin perder el draft ni sobrescribir", async () => {
    state.products = [...clusterProducts(), product(190, pricey, 3)];
    mocks.saveCategoryPricingRules.mockRejectedValueOnce(new CategoryRulesConflictError());
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar tabla/ }));
    expect(await screen.findByText(/cambiaron en otra sesión|La tabla de esta categoría cambió/)).toBeTruthy();
    // The draft survives untouched — nothing was overwritten silently.
    expect((screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement).value).toBe("165");
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeTruthy();
    // The save travelled WITH the expected signature of the loaded table.
    const call = mocks.saveCategoryPricingRules.mock.calls[0];
    expect(typeof call[2]).toBe("string");
  });

  it("P0-1c: la simulación muestra las piezas que quedarían bajo su costo y su existencia", async () => {
    const outlier = product(190, pricey, 3); // Iconic sugerido 170 < costo 190, con existencia
    state.products = [...clusterProducts(), outlier];
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    expect(await screen.findByText(/Piezas cuyo precio sugerido queda BAJO su costo base/)).toBeTruthy();
    expect(
      screen.getAllByText((_, element) => !!element?.textContent?.includes(`${outlier.name} — Iconic $170 vs costo base $190 · con existencia`)).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/no se aplica; requiere excepción|se omiten solas/)).toBeTruthy();
  });

  it("elimina la tabla guardada con confirmación explícita", async () => {
    state.stores[0].pricingRules = {
      byTier: {},
      byCategory: {
        [CAT]: {
          t_retail: { kind: "bands", bands: [{ min: 0, max: 60, price: 290 }, { min: 60, price: 310 }], rounding: "none" },
          t_girly: { kind: "bands", bands: [{ min: 0, max: 60, price: 230 }, { min: 60, price: 260 }], rounding: "none" },
          t_iconic: { kind: "bands", bands: [{ min: 0, max: 60, price: 160 }, { min: 60, price: 170 }], rounding: "none" },
        },
      },
    };
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Quitar tabla de esta categoría/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Quitar tabla$/ }));
    expect(await screen.findByText("Tabla eliminada.")).toBeTruthy();
    // P0-2: deletion also travels with the expected signature of the table it
    // deletes — a concurrent change must refuse the deletion too.
    const deleteCall = mocks.saveCategoryPricingRules.mock.calls[mocks.saveCategoryPricingRules.mock.calls.length - 1];
    expect(deleteCall[0]).toBe(CAT);
    expect(deleteCall[1]).toBeNull();
    expect(typeof deleteCall[2]).toBe("string");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });
});
