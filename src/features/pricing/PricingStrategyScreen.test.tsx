// @vitest-environment jsdom
// #280 — Estrategia de precios: propose → edit → save ONE category's table.
// Critical guarantees from the PO: saving only touches this category's rules
// (never product prices), an incompatible existing config is never silently
// overwritten, pending prices block the save, and a concurrent change to the
// saved table surfaces a banner instead of clobbering the draft.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { PricingStrategyScreen, resetPricingStrategyCategoryForTests } from "./PricingStrategyScreen";
import { ToastProvider } from "../../design-system";
import { fixtureState } from "../../lib/testFixtures";
import { CategoryRulesConflictError } from "../../app/StoreProvider";
import type { Category, PricingRulesConfig, Product, Store, StorePackaging } from "../../types";

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
const CAT2 = "store_olivia__perfumes";

// #538: the band-table draft persists per signed-in person.
const auth = vi.hoisted(() => ({ user: null as { uid: string; email: string } | null }));
vi.mock("../../app/firebase/AuthProvider", () => ({ useAuth: () => ({ user: auth.user }) }));

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
function product(cost: number, prices: Partial<Record<string, number>>, quantityOnHand = 1, cat: string = CAT): Product {
  counter += 1;
  return {
    id: `p${counter}`,
    storeId: "store_olivia",
    name: `Reloj ${counter}`,
    category: "other",
    categoryIds: [cat],
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
  // #531: the screen seeds its category from the URL and the session's last
  // choice — keep every test on a clean address and an empty session.
  resetPricingStrategyCategoryForTests();
  window.history.replaceState({}, "", "/productos/estrategia");
  // #538: a fresh storage per test, like a fresh browser profile.
  localStorage.clear();
  auth.user = { uid: "u-fer", email: "fer@demo.mx" };
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

describe("puente a Reglas con contexto (#289)", () => {
  const SAVED = {
    byTier: {},
    byCategory: {
      [CAT]: {
        t_retail: { kind: "bands", bands: [{ min: 0, max: 60, price: 300 }, { min: 60, price: 320 }], rounding: "none" },
        t_girly: { kind: "bands", bands: [{ min: 0, max: 60, price: 250 }, { min: 60, price: 270 }], rounding: "none" },
        t_iconic: { kind: "bands", bands: [{ min: 0, max: 60, price: 170 }, { min: 60, price: 180 }], rounding: "none" },
      },
    },
  };

  it("con tabla guardada y cambios pendientes ofrece 'Revisar precios pendientes de esta categoría (N)'", async () => {
    state.stores[0].pricingRules = JSON.parse(JSON.stringify(SAVED));
    // 16 de 20 piezas cambiarían (clúster barato); la 21 con categoría secundaria también cuenta.
    const secondary = { ...product(70, pricey), categoryIds: ["otra", CAT] };
    state.products = [...clusterProducts(), secondary];
    mount();
    selectCategory();
    expect(
      await screen.findByRole("button", { name: /Revisar precios pendientes de esta categoría \(21\)/ })
    ).toBeTruthy();
  });

  it("piezas con la categoría en posición SECUNDARIA cuentan en la revisión (igual que resolveRule)", () => {
    state.stores[0].pricingRules = JSON.parse(JSON.stringify(SAVED));
    const secondary = { ...product(70, pricey), categoryIds: ["otra", CAT] };
    state.products = [...clusterProducts(), secondary];
    mount();
    selectCategory();
    // La pieza de $70 caería en la banda alta (Iconic 180 ≠ actual 170): debe estar en el conteo.
    expect(screen.getByRole("button", { name: /Revisar precios pendientes de esta categoría \(21\)/ })).toBeTruthy();
  });
});

describe("#402 limpieza de ruido en Estrategia de precios", () => {
  const packaging = (configured: string[]) => ({
    materials: [
      { id: "m1", name: "Caja", unit: "pieza" as const, estimatedCost: 8, createdAt: "", updatedAt: "" },
      { id: "m2", name: "Bolsa", unit: "pieza" as const, estimatedCost: 3, createdAt: "", updatedAt: "" },
    ],
    byTier: Object.fromEntries(configured.map((tierId) => [tierId, { perPiece: [{ materialId: "m1", quantity: 1 }] }])),
  }) as unknown as StorePackaging;

  it("estado 1 — todos sin configurar: EXACTAMENTE un aviso neutro, sin rojo informativo, con acción a Empaques", async () => {
    const store = oliviaStore();
    (store as Store & { packaging?: StorePackaging }).packaging = packaging([]);
    state.stores[0] = store;
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    // Un solo aviso, neutro (sin clase de danger), con la acción.
    const aviso = await screen.findAllByText(/Empaques por pieza pendientes/i);
    expect(aviso).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Configurar/i })).toBeTruthy();
    // El aviso informativo NO usa el color reservado para dinero/errores.
    expect(aviso[0].className).not.toContain("text-danger");
  });

  it("estado 2 — parcial (Regular/Girly ✓, Iconic pendiente): un aviso nombra SOLO lo faltante y no se repite en la propuesta", async () => {
    const store = oliviaStore();
    (store as Store & { packaging?: StorePackaging }).packaging = packaging(["t_retail", "t_girly"]);
    state.stores[0] = store;
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    const avisos = await screen.findAllByText(/Iconic pendiente/i);
    expect(avisos).toHaveLength(1); // una sola vez — ni en propuesta ni por contribución
  });

  it("estado 3 — todos configurados: cero avisos y ningún contenedor vacío", async () => {
    const store = oliviaStore();
    (store as Store & { packaging?: StorePackaging }).packaging = packaging(["t_retail", "t_girly", "t_iconic"]);
    state.stores[0] = store;
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    expect(screen.queryByText(/pendiente/i)).toBeNull();
    expect(screen.queryByText(/preliminar/i)).toBeNull();
  });
  it("#402 r2 estado 4 — HUECOS (Iconic con Bolsa sin costo): Iconic es SUJETO del resumen y el hueco no se pinta dos veces ni en rojo", async () => {
    const store = oliviaStore();
    const pk = packaging(["t_retail", "t_girly"]);
    // Bolsa SIN costo: Iconic queda configurado pero con hueco (gap != sin configurar).
    (pk.materials[1] as { estimatedCost?: number }).estimatedCost = undefined;
    pk.byTier.t_iconic = { perPiece: [{ materialId: "m2", units: 1 }], perOrder: [] };
    (store as Store & { packaging?: StorePackaging }).packaging = pk;
    state.stores[0] = store;
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    // El resumen no pierde el sujeto: «…Girly ✓ · Iconic pendiente.»
    expect(screen.getByText(/Iconic pendiente/)).toBeTruthy();
    // El hecho neutro del hueco se dice UNA vez (Falta costo de Bolsa en Iconic).
    expect(screen.getByText(/Falta costo de Bolsa en Iconic/)).toBeTruthy();
    // El warning del motor («Costo base de Iconic incompleto…») NO reaparece en rojo.
    expect(screen.queryByText(/Costo base de Iconic incompleto/)).toBeNull();
    // Ningún texto informativo usa el color de dinero.
    const informative = screen.queryAllByText(/incompleto|Contribuciones preliminares/i);
    for (const node of informative) expect(node.className).not.toContain("text-danger");
  });


  it("estado 7 — sin tabla guardada: no aparece la tarjeta «Guarda la tabla…» antes de editar", async () => {
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    expect(screen.queryByText(/Guarda la tabla de esta categoría/i)).toBeNull();
  });
});


describe("#219 — contratos de captura de Estrategia (auditoría)", () => {
  it("el punto decimal no se pierde al teclear: «165.» espera al «5» y guarda 165.5", async () => {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    const field = screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement;
    fireEvent.change(field, { target: { value: "165." } });
    expect(field.value).toBe("165.");
    fireEvent.change(field, { target: { value: "165.5" } });
    expect(field.value).toBe("165.5");
    fireEvent.click(screen.getByRole("button", { name: /Guardar tabla/ }));
    expect(await screen.findByText("Tabla guardada. Los precios de tus productos no cambiaron.")).toBeTruthy();
    const [, rules] = mocks.saveCategoryPricingRules.mock.calls[0];
    expect((rules as Record<string, { bands: Array<{ price: number }> }>).t_iconic.bands[0].price).toBe(165.5);
  });

  it("un precio con fracción sub-centavo se rechaza con mensaje explícito — nunca truncación silenciosa", async () => {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    // A valid edit first: the table is savable before the rejected capture.
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeEnabled();
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165.005" } });
    expect(await screen.findByText(/pesos con centavos \(máximo dos decimales\)/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeDisabled();
    expect(mocks.saveCategoryPricingRules).not.toHaveBeenCalled();
  });

  it("«Hasta $» con fracción sub-centavo bloquea el guardado con el mismo mensaje", async () => {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    fireEvent.change(screen.getAllByLabelText(/Hasta \$/)[0], { target: { value: "60.005" } });
    expect(await screen.findByText(/pesos con centavos \(máximo dos decimales\)/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeDisabled();
  });

  it("captura no numérica en el precio queda visible con error y bloquea guardar — sin 0 silencioso", async () => {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "abc" } });
    expect(await screen.findByText(/pesos con centavos \(máximo dos decimales\)/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeDisabled();
    expect(mocks.saveCategoryPricingRules).not.toHaveBeenCalled();
  });

  it("un precio válido con centavos guarda sin fricción (regresión de magnitud)", async () => {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "131072.02" } });
    expect(screen.queryByText(/máximo dos decimales/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Guardar tabla/ }));
    expect(await screen.findByText("Tabla guardada. Los precios de tus productos no cambiaron.")).toBeTruthy();
    const [, rules] = mocks.saveCategoryPricingRules.mock.calls[0];
    expect((rules as Record<string, { bands: Array<{ price: number }> }>).t_iconic.bands[0].price).toBe(131072.02);
  });

  // Revisora #219 (dictamen PR #517, MAYOR): rawCaptures must not leak across
  // category contexts — a rejected capture typed in one category must never
  // surface as a ghost value/error in another category's editor.
  it("cambiar de categoría no arrastra la captura rechazada de la categoría anterior (repro de la Revisora)", async () => {
    state.categories.push({ ...categoryFixture(), id: CAT2, name: "Perfumes", slug: "perfumes" });
    state.products.push(...Array.from({ length: 6 }, () => product(30, { t_retail: 190, t_girly: 150, t_iconic: 120 }, 1, CAT2)));
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } }); // dirty first
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "999.005" } });
    expect(await screen.findByText(/máximo dos decimales/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeDisabled();
    // Switch context: the new category's editor starts clean.
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: CAT2 } });
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    const iconic = screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement;
    expect(iconic.value).not.toBe("999.005");
    expect(screen.queryByText(/máximo dos decimales/i)).toBeNull();
    // The editor is fully usable: a valid edit enables the save.
    fireEvent.change(iconic, { target: { value: "125" } });
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeEnabled();
  });

  it("«Restaurar propuesta» reemplaza la tabla y no conserva la captura inválida previa", async () => {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "999.005" } });
    expect(await screen.findByText(/máximo dos decimales/i)).toBeTruthy();
    // #538: unsaved edits are a loss — the restore asks first.
    fireEvent.click(screen.getByRole("button", { name: /Restaurar propuesta/ }));
    expect(screen.getByText(/¿Restaurar la propuesta y perder tus cambios\?/)).toBeTruthy();
    expect(screen.queryByText(/máximo dos decimales/i)).toBeTruthy(); // todavía nada se ha sustituido
    fireEvent.click(screen.getAllByRole("button", { name: "Restaurar propuesta" }).pop()!);
    expect(screen.queryByText(/máximo dos decimales/i)).toBeNull();
    // A follow-up valid edit proves the editor is not dead-ended by a ghost.
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    expect(screen.getByRole("button", { name: /Guardar tabla/ })).toBeEnabled();
  });

  it("«Descartar mis cambios y recargar» (banner de concurrencia) no conserva la captura inválida del draft", async () => {
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
    // A valid edit makes the draft dirty (banner precondition)…
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    // …then the rejected capture leaves the ghost the discard must clear.
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "999.005" } });
    expect(await screen.findByText(/máximo dos decimales/i)).toBeTruthy();
    // Another session saves a different table under our feet → banner.
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
    fireEvent.click(screen.getByRole("button", { name: /Descartar mis cambios y recargar/ }));
    expect(screen.queryByText(/máximo dos decimales/i)).toBeNull();
    expect((screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement).value).toBe("150");
  });
});

describe("#526 Tabla de bandas — etiquetas que guían la tarea", () => {
  it("el subtítulo nombra los niveles REALES de la tienda (fixture: Regular, Girly, Iconic)", () => {
    mount();
    expect(screen.getByText(/rangos de costo con precios Regular, Girly e Iconic/)).toBeTruthy();
  });

  it("una tienda con Menudeo/Mayoreo/Emprendedora ve SUS nombres — nunca los de otra tienda", () => {
    const store = oliviaStore();
    store.priceTiers = [
      { id: "t_retail", label: "Menudeo", order: 1 },
      { id: "t_girly", label: "Mayoreo", order: 2 },
      { id: "t_iconic", label: "Emprendedora", order: 3 },
    ];
    state.stores[0] = store;
    mount();
    expect(screen.getByText(/rangos de costo con precios Menudeo, Mayoreo y Emprendedora/)).toBeTruthy();
    expect(screen.queryByText(/Iconic, Girly y Regular/)).toBeNull();
  });

  it("primera banda: conserva el 0 deshabilitado y SIN la nota «la primera banda abre en $0»", async () => {
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    const desde = screen.getAllByLabelText("Desde $")[0] as HTMLInputElement;
    expect(desde.value).toBe("0");
    expect(desde.disabled).toBe(true);
    expect(screen.queryByText(/la primera banda abre en \$0/)).toBeNull();
  });
});

describe("#529 hints de mediana en Tabla de bandas", () => {
  it("soporte sólido: el hint «Mediana actual, sólido…» NO se repite bajo cada precio de cada banda", async () => {
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    // 4 bandas × 3 niveles con soporte sólido = hasta 12 repeticiones antes;
    // ahora el estado sano no necesita aclaración bajo cada campo.
    expect(screen.queryByText(/Mediana actual/)).toBeNull();
  });

  it("un nivel poco respaldado o sin evidencia: marca corta en su campo y el texto largo UNA sola vez en la leyenda (dictamen QA #529)", async () => {
    // Banda baja: 5 piezas con los tres precios (sólido). Banda alta: 4 piezas —
    // sólo 2 con precio Girly (weak: <3 evidencias) y NINGUNA con Iconic
    // (pending) → cada advertencia aparece UNA vez, en la banda alta.
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 2 }, () => product(95, { t_retail: pricey.t_retail, t_girly: pricey.t_girly })),
      ...Array.from({ length: 2 }, () => product(95, { t_retail: pricey.t_retail })),
    ];
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    // Short mark on each affected field (exactly the two of the fixture).
    expect(screen.getAllByText(/^poco respaldado$/).length).toBe(1);
    expect(screen.getAllByText(/^pendiente: sin evidencia$/).length).toBe(1);
    // The LONG text lives ONCE, in the per-category legend — never per field.
    expect(screen.getAllByText(/Mediana actual/).length).toBe(1);
    expect(screen.queryByText(/Mediana actual, sólido/)).toBeNull();
  });

  it("varias bandas débiles: cada campo lleva su marca corta y la leyenda nombra todas las bandas afectadas (QA #529 reincidencia)", async () => {
    // Two high bands, each with only 2 Girly evidences (weak in BOTH).
    state.products = [
      ...Array.from({ length: 4 }, () => product(20, cheap)),
      ...Array.from({ length: 2 }, () => product(60, { t_retail: 240, t_girly: 190 })),
      ...Array.from({ length: 2 }, () => product(95, { t_retail: pricey.t_retail, t_girly: pricey.t_girly })),
    ];
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    // Short marks on every affected field (Regular + Girly weak, Iconic pending).
    expect(screen.getAllByText(/^poco respaldado$/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/^pendiente: sin evidencia$/).length).toBeGreaterThanOrEqual(1);
    // ONE legend naming EVERY affected level with its band.
    const legends = screen.getAllByText(/Mediana actual/);
    expect(legends.length).toBe(1);
    const legendText = legends[0].textContent ?? "";
    expect(legendText).toMatch(/banda 2/);
    for (const tier of ["Regular", "Girly", "Iconic"]) expect(legendText).toContain(tier);
    // No per-field long text anywhere (the reincidence QA measured).
    expect(screen.queryByText(/Mediana actual, \w+/)).toBeNull();
  });
});


describe("#531 evidencia por banda con la tabla real", () => {
  it("tras quitar una banda, piezas y contribución mínima reflejan la estructura editada", async () => {
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 4 }, () => product(95, pricey)),
    ];
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    // Propuesta: 2 bandas [0,~57.5) con 5 piezas y [57.5,∞) con 4.
    expect(screen.getByText(/Piezas en esta banda \(5\)/)).toBeTruthy();
    // Quitar la ÚLTIMA banda: la primera absorbe el rango y queda abierta.
    const quitar = screen.getAllByRole("button", { name: "Quitar" });
    fireEvent.click(quitar[quitar.length - 1]);
    // La evidencia ahora pertenece a la banda vigente: 9 piezas y la
    // contribución usa el precio del borrador contra el peor costo (95).
    expect(screen.getByText(/Piezas en esta banda \(9\)/)).toBeTruthy();
    expect(screen.getByText(/Contribución mínima/).textContent).toMatch(/Regular \$195/);
  });

  it("«Dividir» sin corte posible queda deshabilitado con su motivo visible", async () => {
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 4 }, () => product(95, pricey)),
    ];
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    // Cada banda de la propuesta tiene un solo costo: ningún corte válido
    // (una mitad quedaría vacía) → deshabilitado con motivo.
    expect(screen.getAllByRole("button", { name: "Dividir" })[0]).toBeDisabled();
    expect(screen.getAllByText(/Dividir no disponible/).length).toBeGreaterThan(0);
    // Al fusionar (quitar la banda alta) la banda única mezcla costos
    // {20,95}: el punto medio 57.5 parte piezas en ambos lados → habilitado.
    const quitar = screen.getAllByRole("button", { name: "Quitar" });
    fireEvent.click(quitar[quitar.length - 1]);
    expect(screen.getAllByRole("button", { name: "Dividir" })[0]).toBeEnabled();
    // Estrechar «Hasta» a 20 deja fuera todos los costos: sin corte posible.
    fireEvent.change(screen.getAllByLabelText("Hasta $")[0], { target: { value: "20" } });
    expect(screen.getAllByRole("button", { name: "Dividir" })[0]).toBeDisabled();
  });

  it("la categoría elegida sobrevive vía ?categoria= al volver de Inicio o del simulador", async () => {
    const second: Category = { ...categoryFixture(), id: "store_olivia__aros", slug: "aros" };
    state.categories = [categoryFixture(), second];
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 4 }, () => product(95, pricey)),
    ];
    window.history.replaceState({}, "", `/productos/estrategia?categoria=${CAT}`);
    mount();
    // Sin re-elegir: la propuesta de la categoría aparece directamente.
    await screen.findByText("Propuesta");

    // Elegir otra categoría actualiza el parámetro en la URL.
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: second.id } });
    expect(window.location.search).toContain(`categoria=${encodeURIComponent(second.id)}`);
  });
});

describe("#531 re-entrada y formato de dinero negativo", () => {
  it("re-entrar por menú (URL limpia) conserva la última categoría de la sesión", async () => {
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 4 }, () => product(95, pricey)),
    ];
    const view = mount();
    selectCategory();
    await screen.findByText("Propuesta");
    // Salió por el menú: URL limpia, misma sesión (remonte del componente).
    view.unmount();
    window.history.replaceState({}, "", "/productos/estrategia");
    mount();
    await screen.findByText("Propuesta");
    expect((screen.getByLabelText("Categoría") as HTMLSelectElement).value).toBe(CAT);
  });

  it("una contribución negativa se muestra como -$N (convención #327), nunca $-N", async () => {
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 4 }, () => product(95, pricey)),
    ];
    mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    // Precio Regular de la banda fusionada bajo el peor costo (95):
    // 90 − 95 = −5 → «Regular -$5».
    const quitar = screen.getAllByRole("button", { name: "Quitar" });
    fireEvent.click(quitar[quitar.length - 1]);
    fireEvent.change(screen.getAllByLabelText(/Regular \(pesos\)/)[0], { target: { value: "90" } });
    const line = screen.getByText(/Contribución mínima/).textContent ?? "";
    expect(line).toMatch(/Regular -\$5/);
    expect(line).not.toMatch(/\$-/);
  });
});

describe("#531 ida y vuelta al simulador con concurrencia y entre tiendas", () => {
  function products526() {
    state.products = [
      ...Array.from({ length: 5 }, () => product(20, cheap)),
      ...Array.from({ length: 4 }, () => product(95, pricey)),
    ];
  }

  it("«Simular banda» conserva el borrador sucio al volver (mismo guardado)", async () => {
    products526();
    const view = mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    fireEvent.change(screen.getAllByLabelText(/Regular \(pesos\)/)[0], { target: { value: "300" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Simular banda" })[0]);
    view.unmount();
    // Regresa desde el simulador con ?categoria= (el botón real la lleva).
    window.history.replaceState({}, "", `/productos/estrategia?categoria=${CAT}`);
    mount();
    expect((screen.getAllByLabelText(/Regular \(pesos\)/)[0] as HTMLInputElement).value).toBe("300");
  });

  it("criterio QA con CINCO bandas: explicación general UNA vez y marcas puntuales en cada banda afectada (dictamen #529)", async () => {
    // A SAVED 5-band table (the criterion's measurement shape) over products
    // whose evidence leaves several bands weak/pending:
    // banda 2 Girly débil (2 evidencias) · banda 3 Girly débil + Iconic pendiente · banda 4 Iconic pendiente.
    state.products = [
      ...Array.from({ length: 4 }, () => product(20, cheap)), // banda 1 sólida
      ...Array.from({ length: 2 }, () => product(60, cheap)),
      ...Array.from({ length: 2 }, () => product(65, { t_retail: 290, t_iconic: 160 })), // banda 2: Girly 2/4
      ...Array.from({ length: 2 }, () => product(120, { t_retail: 300, t_girly: 240 })),
      ...Array.from({ length: 2 }, () => product(130, { t_retail: 300 })), // banda 3: Girly 2/4, Iconic 0/4
      ...Array.from({ length: 4 }, () => product(250, { t_retail: 310, t_girly: 260 })), // banda 4: Iconic 0/4
      ...Array.from({ length: 4 }, () => product(500, pricey)), // banda 5 sólida
    ];
    state.stores[0].pricingRules = {
      byTier: {},
      byCategory: {
        [CAT]: {
          t_retail: { kind: "bands", bands: [
            { min: 0, max: 50, price: 290 }, { min: 50, max: 100, price: 295 },
            { min: 100, max: 200, price: 300 }, { min: 200, max: 400, price: 310 },
            { min: 400, price: 320 },
          ], rounding: "none" },
          t_girly: { kind: "bands", bands: [
            { min: 0, max: 50, price: 230 }, { min: 50, max: 100, price: 235 },
            { min: 100, max: 200, price: 240 }, { min: 200, max: 400, price: 250 },
            { min: 400, price: 260 },
          ], rounding: "none" },
          t_iconic: { kind: "bands", bands: [
            { min: 0, max: 50, price: 160 }, { min: 50, max: 100, price: 165 },
            { min: 100, max: 200, price: 170 }, { min: 200, max: 400, price: 175 },
            { min: 400, price: 180 },
          ], rounding: "none" },
        },
      },
    };
    mount();
    selectCategory();
    // A compatible SAVED table is adopted directly (no proposal step needed).
    await screen.findAllByLabelText("Hasta $");
    // The general explanation appears EXACTLY once — the per-category legend.
    const legends = screen.getAllByText(/Mediana actual/);
    expect(legends.length).toBe(1);
    const legendText = legends[0].textContent ?? "";
    expect(legendText).toMatch(/banda 2/);
    expect(legendText).toMatch(/banda 3/);
    expect(legendText).toMatch(/banda 4/);
    expect(legendText).not.toMatch(/banda 1/);
    expect(legendText).not.toMatch(/banda 5/);
    // Point marks stay visible in their exact fields: banda2 Girly + banda3
    // Girly + banda3 Iconic + banda4 Iconic = 4 marks.
    expect(screen.getAllByText(/^poco respaldado$/).length).toBe(2);
    expect(screen.getAllByText(/^pendiente: sin evidencia$/).length).toBe(2);
    // Zero per-field long text (the reincidence QA measured with 5 bands).
    expect(screen.queryByText(/Mediana actual, \w+/)).toBeNull();
  });

  it("entrar por la PESTAÑA «Simulador» también conserva el borrador sucio al volver (dictamen QA #531)", async () => {
    products526();
    const view = mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    fireEvent.change(screen.getAllByLabelText(/Regular \(pesos\)/)[0], { target: { value: "300" } });
    // The header TAB (not «Simular banda») is the door QA found open.
    fireEvent.click(screen.getByRole("button", { name: /^Simulador$/ }));
    view.unmount();
    window.history.replaceState({}, "", `/productos/estrategia?categoria=${CAT}`);
    mount();
    // BOTH the unsaved draft AND the category survive the tab round-trip.
    expect((screen.getAllByLabelText(/Regular \(pesos\)/)[0] as HTMLInputElement).value).toBe("300");
    expect((screen.getByLabelText("Categoría") as HTMLSelectElement).value).toBe(CAT);
  });

  it("si la tabla guardada cambió durante el ida y vuelta, el borrador vuelve Y el banner de concurrencia habla (no se pierde en silencio)", async () => {
    products526();
    const view = mount();
    selectCategory();
    await screen.findByText("Propuesta");
    fireEvent.click(screen.getByRole("button", { name: "Editar esta propuesta" }));
    fireEvent.change(screen.getAllByLabelText(/Regular \(pesos\)/)[0], { target: { value: "300" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Simular banda" })[0]);
    view.unmount();
    // Otra sesión guardó una tabla distinta mientras tanto.
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
    window.history.replaceState({}, "", `/productos/estrategia?categoria=${CAT}`);
    mount();
    // El borrador sigue ahí (no se pierde en silencio)…
    expect((screen.getAllByLabelText(/Regular \(pesos\)/)[0] as HTMLInputElement).value).toBe("300");
    // …y la pantalla avisa el cambio concurrente en lugar de callar.
    expect(await screen.findByText(/cambió mientras editabas|otra sesión/i)).toBeTruthy();
  });

  it("la última categoría NO filtra a otra tienda (select sin valor huérfano ni análisis fantasma)", async () => {
    products526();
    const view = mount();
    selectCategory();
    await screen.findByText("Propuesta");
    // Cambia a OTRA tienda (id distinto) y re-entra por menú (URL limpia):
    // el guard por tienda debe rechazar la memoria de la categoría ajena.
    const otra = fixtureState();
    otra.stores[0] = oliviaStore();
    otra.activeStoreId = otra.stores[2].id; // Joyería: otra tienda real (id distinto)
    mocks.state = otra;
    view.unmount();
    window.history.replaceState({}, "", "/productos/estrategia");
    mount();
    expect((screen.getByLabelText("Categoría") as HTMLSelectElement).value).toBe("");
    // Matcher que atraviesa nodos anidados: sin análisis «0 piezas» fantasma.
    const phantom = screen.queryByText((_, el) => !!el?.textContent?.includes("piezas en la categoría"));
    expect(phantom).toBeNull();
  });

  it("un stash LIMPIO vencido cede ante la tabla guardada fresca (sin banner)", async () => {
    products526();
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
    await screen.findAllByLabelText("Hasta $"); // tabla guardada adoptada (limpia)
    fireEvent.click(screen.getAllByRole("button", { name: "Simular banda" })[0]);
    view.unmount();
    // Otra sesión guarda una tabla DISTINTA mientras tanto.
    state.stores[0].pricingRules = {
      byTier: {},
      byCategory: {
        [CAT]: {
          t_retail: { kind: "bands", bands: [{ min: 0, max: 80, price: 290 }, { min: 80, price: 310 }], rounding: "none" },
          t_girly: { kind: "bands", bands: [{ min: 0, max: 80, price: 230 }, { min: 80, price: 260 }], rounding: "none" },
          t_iconic: { kind: "bands", bands: [{ min: 0, max: 80, price: 160 }, { min: 80, price: 170 }], rounding: "none" },
        },
      },
    };
    window.history.replaceState({}, "", `/productos/estrategia?categoria=${CAT}`);
    mount();
    // El stash limpio cede: la tabla FRESCA (Hasta 80) se adopta, sin banner.
    expect((screen.getAllByLabelText("Hasta $")[0] as HTMLInputElement).value).toBe("80");
    expect(screen.queryByText(/cambiaron en otra sesión/i)).toBeNull();
  });
});

// #538 rehecho sobre main (#531/#533): la categoría ya sobrevive por la URL y
// por la memoria de sesión; este borrador persistido viaja con ella.
describe("#538 borrador de Estrategia conservado", () => {
  const STORE = "store_olivia";
  const keyFor = (uid = "u-fer", cat = CAT) => `store-os:strategy-draft:${uid}:${STORE}:${cat}`;
  const iconicFirst = () => (screen.getAllByLabelText(/Iconic \(pesos\)/)[0] as HTMLInputElement).value;
  const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null") as { draft: { prices: Record<string, number[]> } } | null;

  function editAndDirty(value = "165") {
    mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value } });
  }

  it("cambiar de categoría y volver conserva las ediciones; nada se guarda en Firestore", () => {
    editAndDirty();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "" } });
    selectCategory();
    expect(iconicFirst()).toBe("165");
    expect(screen.getByText(/Recuperamos tus cambios sin guardar/)).toBeTruthy();
    expect(mocks.saveCategoryPricingRules).not.toHaveBeenCalled();
  });

  it("F5 en la misma pestaña: vuelve la categoría y con ella el borrador, sin re-elegirla", async () => {
    const view = mount();
    selectCategory();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "165" } });
    view.unmount();
    // #531: la elección viaja en la URL; el borrador, en el almacenamiento de la persona.
    expect(window.location.search).toBe(`?categoria=${encodeURIComponent(CAT)}`);
    expect(stored(keyFor())?.draft.prices.t_iconic?.[0]).toBe(165);
    mount();
    await screen.findAllByLabelText(/Iconic \(pesos\)/);
    expect((screen.getByLabelText("Categoría") as HTMLSelectElement).value).toBe(CAT);
    expect(iconicFirst()).toBe("165");
    expect(screen.getByText(/Recuperamos tus cambios sin guardar/)).toBeTruthy();
  });

  it("volver por el menú (URL limpia): la memoria de sesión trae la categoría y el borrador la sigue", async () => {
    editAndDirty();
    cleanup();
    window.history.replaceState({}, "", "/productos/estrategia");
    mount();
    await screen.findAllByLabelText(/Iconic \(pesos\)/);
    expect((screen.getByLabelText("Categoría") as HTMLSelectElement).value).toBe(CAT);
    expect(iconicFirst()).toBe("165");
  });

  it("«Restaurar propuesta» con ediciones sin guardar pide confirmación; Cancelar conserva", () => {
    editAndDirty();
    fireEvent.click(screen.getByRole("button", { name: /Restaurar propuesta/ }));
    expect(screen.getByText(/¿Restaurar la propuesta y perder tus cambios\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(iconicFirst()).toBe("165");
    expect(mocks.saveCategoryPricingRules).not.toHaveBeenCalled();
  });

  it("confirmar la restauración sustituye SOLO el borrador: la propuesta queda en el editor y en el almacenamiento, Firestore intacto", () => {
    editAndDirty();
    fireEvent.click(screen.getByRole("button", { name: /Restaurar propuesta/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Restaurar propuesta" }).pop()!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(iconicFirst()).not.toBe("165");
    // #531: la propuesta adoptada es un cambio guardable — por eso también es el borrador vigente.
    expect(stored(keyFor())?.draft.prices.t_iconic?.[0]).not.toBe(165);
    expect(mocks.saveCategoryPricingRules).not.toHaveBeenCalled();
  });

  it("guardar la tabla limpia el borrador guardado", async () => {
    editAndDirty();
    expect(stored(keyFor())).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Guardar tabla/ }));
    await screen.findByText("Tabla guardada. Los precios de tus productos no cambiaron.");
    expect(localStorage.getItem(keyFor())).toBeNull();
  });

  it("el borrador es de la persona: con otra sesión no se adopta ni se toca", async () => {
    editAndDirty();
    cleanup();
    auth.user = { uid: "u-otra", email: "otra@demo.mx" };
    mount();
    selectCategory();
    expect(screen.queryByText(/Recuperamos tus cambios sin guardar/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Editar esta propuesta/ }));
    expect(iconicFirst()).not.toBe("165");
    expect(stored(keyFor())?.draft.prices.t_iconic?.[0]).toBe(165);
    // Sus propias ediciones sí se guardan, bajo su propia llave.
    expect(stored(keyFor("u-otra"))?.draft.prices.t_iconic?.[0]).not.toBe(165);
  });

  it("el borrador es de la categoría: otra categoría de la misma persona no lo adopta", () => {
    localStorage.setItem(keyFor("u-fer", CAT2), JSON.stringify({ v: 1, draftBase: "", savedAt: "", draft: { limits: [{ min: 0 }], prices: { t_iconic: [999] }, dirty: true } }));
    editAndDirty();
    expect(iconicFirst()).toBe("165");
    expect(stored(keyFor("u-fer", CAT2))?.draft.prices.t_iconic?.[0]).toBe(999);
  });

  const savedTable = (max: number): PricingRulesConfig => ({
    byTier: {},
    byCategory: {
      [CAT]: {
        t_retail: { kind: "bands", bands: [{ min: 0, max, price: 290 }, { min: max, price: 310 }], rounding: "none" },
        t_girly: { kind: "bands", bands: [{ min: 0, max, price: 230 }, { min: max, price: 260 }], rounding: "none" },
        t_iconic: { kind: "bands", bands: [{ min: 0, max, price: 160 }, { min: max, price: 170 }], rounding: "none" },
      },
    },
  });
  function anotherSessionSaves(pricingRules: PricingRulesConfig) {
    const other = fixtureState();
    other.stores[0] = oliviaStore();
    other.stores[0].pricingRules = pricingRules;
    mocks.state = other;
  }
  const rerender = (view: ReturnType<typeof mount>) => view.rerender(<ToastProvider><PricingStrategyScreen /></ToastProvider>);

  it("tras F5, una tabla guardada en otra sesión se advierte y el borrador recuperado no se pierde", async () => {
    editAndDirty();
    cleanup();
    anotherSessionSaves(savedTable(50));
    mount();
    await screen.findAllByLabelText(/Iconic \(pesos\)/);
    expect(screen.getByText(/cambiaron en otra sesión/i)).toBeTruthy();
    expect(iconicFirst()).toBe("165");
  });

  it("descartar explícitamente elimina el borrador guardado (con tabla guardada compatible)", () => {
    editAndDirty();
    cleanup();
    const view = mount(); // F5: la URL trae la categoría y el almacenamiento, el borrador
    anotherSessionSaves(savedTable(50));
    rerender(view);
    expect(screen.getByText(/cambiaron en otra sesión/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Descartar mis cambios y recargar/ }));
    expect(localStorage.getItem(keyFor())).toBeNull();
    expect(iconicFirst()).not.toBe("165");
    cleanup();
    mount(); // un F5 más: nada resucita
    expect(iconicFirst()).not.toBe("165");
    expect(screen.queryByText(/Recuperamos tus cambios sin guardar/)).toBeNull();
  });

  it("descartar elimina también el borrador cuando la tabla ajena es incompatible (el editor queda sin tabla)", () => {
    editAndDirty();
    cleanup();
    const view = mount();
    anotherSessionSaves({ byTier: {}, byCategory: { [CAT]: { t_retail: { kind: "markup", percent: 10 } } } } as unknown as PricingRulesConfig);
    rerender(view);
    fireEvent.click(screen.getByRole("button", { name: /Descartar mis cambios y recargar/ }));
    expect(screen.queryByLabelText(/Iconic \(pesos\)/)).toBeNull();
    expect(localStorage.getItem(keyFor())).toBeNull();
  });

  it("eliminar la tabla guardada elimina también su borrador", async () => {
    state.stores[0].pricingRules = savedTable(60);
    mount();
    selectCategory(); // con tabla guardada el editor abre solo
    fireEvent.change(screen.getAllByLabelText(/Iconic \(pesos\)/)[0], { target: { value: "175" } });
    expect(stored(keyFor())?.draft.prices.t_iconic?.[0]).toBe(175);
    fireEvent.click(screen.getByRole("button", { name: /Quitar tabla de esta categoría/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Quitar tabla$/ }));
    await screen.findByText("Tabla eliminada.");
    expect(localStorage.getItem(keyFor())).toBeNull();
  });
});
