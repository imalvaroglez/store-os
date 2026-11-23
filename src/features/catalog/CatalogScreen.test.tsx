// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoreProvider } from "../../app/StoreProvider";
import { Button, ToastProvider } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { resetListRestoreForTests } from "../../lib/listRestore";
import { CatalogScreen } from "./CatalogScreen";
import { fixtureState } from "../../lib/testFixtures";
import type { AppState, Product } from "../../types";
const mocks = vi.hoisted(() => ({
  user: { uid: "uid_test", email: "test@store-os.mx", role: "super_admin" as const },
  state: null as AppState | null,
  loadCloudState: vi.fn(),
  saveProduct: vi.fn(),
}));

vi.mock("../../app/firebase/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: true, error: null, signOut: async () => {} }),
}));
vi.mock("../../app/firebase/firestoreData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/firebase/firestoreData")>();
  return {
    ...actual,
    loadCloudState: mocks.loadCloudState,
    subscribeCloudState: vi.fn(() => () => {}),
    saveEntity: vi.fn(async () => {}),
    // #373: product saves persist through the concurrent-preserving tx; in
    // unit tests it behaves as a passthrough of the incoming product.
    saveProductPreservingConcurrentTx: mocks.saveProduct,
    projectPublicForStore: vi.fn(async () => {}),
    upsertPublicProduct: vi.fn(async () => {}),
  };
});

// Mount the real provider with an explicit authenticated cloud-state mock.
function withState(state: AppState) {
  mocks.state = state;
  mocks.loadCloudState.mockImplementation(async () => state);
  return ({ children }: { children: ReactNode }) => <StoreProvider><ToastProvider>{children}</ToastProvider></StoreProvider>;
}

const OLIVIA = "store_olivia";
const SANTI = "store_santi";
const CAT_ANILLOS = `${OLIVIA}__anillos`;
const CAT_ARETES = `${OLIVIA}__aretes`;
const CAT_BOLSAS = `${OLIVIA}__bolsas`;

function tieredProduct(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    storeId: OLIVIA,
    category: "other",
    isPublic: true,
    status: "published",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    prices: { t_retail: 300, t_mayoreo: 220 },
    quantityOnHand: 5,
    ...overrides,
  } as Product;
}

/** Minimal color variant for #365 fixtures (required timestamps included). */
function variant(id: string, color: string, quantityOnHand?: number) {
  return { id, color, quantityOnHand, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" };
}

/** Olivia inventory_tiered with two categories and three products covering
 *  ties (price), mixed case names, zero/negative stock and distinct dates. */
function sortFilterState(): AppState {
  const state = fixtureState();
  state.categories = [
    { id: CAT_ANILLOS, storeId: OLIVIA, name: "Anillos", slug: "anillos", sortOrder: 1, active: true, createdAt: state.stores[0].createdAt, updatedAt: state.stores[0].createdAt },
    { id: CAT_ARETES, storeId: OLIVIA, name: "Aretes", slug: "aretes", sortOrder: 2, active: true, createdAt: state.stores[0].createdAt, updatedAt: state.stores[0].createdAt },
    { id: CAT_BOLSAS, storeId: OLIVIA, name: "Bolsas", slug: "bolsas", sortOrder: 3, active: true, createdAt: state.stores[0].createdAt, updatedAt: state.stores[0].createdAt },
  ];
  state.products = [
    tieredProduct({ id: "p1", name: "Anillo Blossom", categoryIds: [CAT_ANILLOS], quantityOnHand: 5, createdAt: "2026-08-01T00:00:00.000Z" }),
    tieredProduct({ id: "p2", name: "anillo perla", categoryIds: [CAT_ANILLOS], quantityOnHand: 0, createdAt: "2026-08-05T00:00:00.000Z" }),
    tieredProduct({ id: "p3", name: "Aretes Luna", categoryIds: [CAT_ARETES], prices: { t_retail: 150 }, quantityOnHand: -2, createdAt: "2026-08-10T00:00:00.000Z" }),
  ];
  const olivia = state.stores.find((s) => s.id === OLIVIA)!;
  olivia.priceTiers = [
    { id: "t_retail", label: "Menudeo", order: 1 },
    { id: "t_mayoreo", label: "Mayoreo", order: 2 },
  ];
  olivia.defaultTierId = "t_retail";
  return state;
}

/** Product names in DOM order (the card grid renders each name in an h3). */
function cardNames(): string[] {
  return Array.from(document.querySelectorAll("h3")).map((h) => h.textContent ?? "");
}

function changeSelect(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function renderCatalog(state: AppState) {
  const Wrapper = withState(state);
  const view = render(<Wrapper><CatalogScreen /></Wrapper>);
  // #252: the screen renders null until hydration (loadCloudState) lands, so
  // the select only exists post-hydration — but the DOM a test reads after a
  // filter change may not be settled yet, and a live store-key change in
  // useListRestore resets filters. Never assert synchronously after changing
  // a filter: wait for the settled state (see the filter tests below).
  await screen.findByLabelText("Categoría");
  return view;
}

function StoreToggleButton() {
  const { activeStore, setActiveStore } = useStore();
  return <Button onClick={() => setActiveStore(activeStore?.id === OLIVIA ? SANTI : OLIVIA)}>Cambiar tienda</Button>;
}

function lastByLabel(label: string) {
  const fields = screen.getAllByLabelText(label);
  return fields[fields.length - 1];
}

beforeEach(() => {
  mocks.saveProduct.mockReset().mockImplementation(async (_baseline: unknown, next: Product) => next);
  resetListRestoreForTests(); // #233: la caché de lista es de sesión; cada prueba parte de defaults
  localStorage.clear();
});

// #346 (hardening): the flake's ORIGINAL diagnosis (residual DOM) was
// refuted — the failing test was the first of the file and RTL auto-cleanup
// was already active. The surviving candidates (a late filter reset from
// useListRestore's store-key change, or an unsettled async render) stay open
// in the issue. This keeps BOTH protections from the accepted #291 fix —
// explicit cleanup (documentation of intent; harmless with auto-cleanup) and
// queries scoped to each test's own container.
afterEach(() => {
  cleanup();
});

describe("CatalogScreen filtro por categoría real", () => {
  it("filtra por categoría activa, muestra 'N de M piezas' y Limpiar restaura", async () => {
    // #346: queries scoped to THIS render's container (the #291 technique) so
    // only this screen's own grid can satisfy or defeat the assertion.
    const view = await renderCatalog(sortFilterState());
    const names = () => Array.from(view.container.querySelectorAll("h3")).map((h) => h.textContent ?? "");

    changeSelect("Categoría", CAT_ANILLOS);
    // Filter keeps the active sort (default: Fecha, recientes primero). The
    // list settles asynchronously — assert on the settled state (#252).
    await waitFor(() => expect(names()).toEqual(["anillo perla", "Anillo Blossom"]));
    expect(screen.getByText("2 de 3 piezas")).toBeTruthy();

    fireEvent.click(screen.getByText("Limpiar"));
    await waitFor(() => expect(names()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]));
    expect(screen.queryByText("Limpiar")).toBeNull();
  });

  it("#463: el desglose de comprometidas abre desde la ficha, muestra los pedidos y navega al exacto", async () => {
    const state = sortFilterState();
    // Order A: 3 pieces, 1 delivered → 2 pending; order B: 1 pending.
    state.customers = [
      { id: "cust_lucia", storeId: OLIVIA, name: "Lucía", createdAt: "", updatedAt: "" },
      { id: "cust_maria", storeId: OLIVIA, name: "María", createdAt: "", updatedAt: "" },
    ] as never;
    const now = "2026-11-10T10:00:00.000Z";
    const orderDoc = (id: string, customerId: string, quantity: number, deliveries?: unknown[]) => ({
      id, storeId: OLIVIA, customerId,
      items: [{ lineId: `${id}_L0`, productId: "p1", productName: "Anillo Blossom", quantity, unitPrice: 300, subtotal: 300 * quantity }],
      deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid", schemaVersion: 2,
      createdAt: now, updatedAt: now, ...(deliveries ? { deliveries } : {}),
    });
    state.orders = [
      orderDoc("order_aaa111", "cust_lucia", 3, [{ id: "d1", at: now, by: "uid_test", lines: [{ productId: "p1", quantity: 1 }] }]),
      orderDoc("order_bbb222", "cust_maria", 1),
    ] as never;
    const view = await renderCatalog(state);

    // The committed CELL on p1's card is the drill-down control (2 + 1 = 3)
    // — the whole StatRow is one tap target (#463 r2).
    const trigger = view.container.querySelector('button[title="Ver pedidos con piezas comprometidas (3)"]')!;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: /Piezas comprometidas/ });
    // The card itself opens the editor on click — the drill-down trigger must
    // not bubble into it (found in the live Preview pass).
    expect(screen.queryByRole("dialog", { name: "Editar producto" })).toBeNull();
    const summary = within(sheet).getAllByText((_, element) =>
      element?.tagName === "P" && element.textContent === "3 piezas apartadas en 2 pedidos. Toca un pedido para abrirlo."
    );
    expect(summary).toHaveLength(1);
    expect(within(sheet).getByText(/#AAA111/)).toBeTruthy();
    expect(within(sheet).getByText(/Lucía/)).toBeTruthy();
    expect(within(sheet).getByText(/María/)).toBeTruthy();

    // Tapping the exact order closes the sheet and routes to its admin page.
    const paths: string[] = [];
    const onPop = () => paths.push(window.location.pathname);
    window.addEventListener("popstate", onPop);
    fireEvent.click(within(sheet).getByRole("button", { name: /Abrir pedido BBB222/ }));
    window.removeEventListener("popstate", onPop);
    expect(paths).toContain("/pedidos/order_bbb222");
    expect(screen.queryByRole("dialog", { name: /Piezas comprometidas/ })).toBeNull();
  });

  it("#463: con cero comprometidas la cifra queda como número plano, sin control", async () => {
    const view = await renderCatalog(sortFilterState());
    expect(view.container.querySelector('button[title^="Ver pedidos con piezas comprometidas"]')).toBeNull();
  });

  it("#463 r2: la celda completa abre el desglose por teclado y no abre el editor", async () => {
    const state = sortFilterState();
    const now = "2026-11-10T10:00:00.000Z";
    state.customers = [
      { id: "cust_lucia", storeId: OLIVIA, name: "Lucía", createdAt: "", updatedAt: "" },
    ] as never;
    state.orders = [
      {
        id: "order_kkk333", storeId: OLIVIA, customerId: "cust_lucia",
        items: [{ lineId: "k_L0", productId: "p1", productName: "Anillo Blossom", quantity: 2, unitPrice: 300, subtotal: 600 }],
        deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid", schemaVersion: 2, createdAt: now, updatedAt: now,
      },
    ] as never;
    const view = await renderCatalog(state);
    const cell = view.container.querySelector('button[title^="Ver pedidos con piezas comprometidas"]') as HTMLButtonElement;
    expect(cell).toBeTruthy();
    cell.focus();
    // A native button element activates on Enter in real browsers; jsdom does not
    // synthesize that click, so the test drives the same activation.
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.click(cell);
    const sheet = await screen.findByRole("dialog", { name: /Piezas comprometidas/ });
    expect(sheet).toBeTruthy();
    // El foco en la celda no abrió el editor del producto (burbuja controlada).
    expect(screen.queryByRole("dialog", { name: "Editar producto" })).toBeNull();
  });

  it("muestra solo productos por surtir según el umbral o si están agotados", async () => {
    const state = sortFilterState();
    state.products[0].lowStockAt = 3;
    state.products[1].lowStockAt = 0;
    // An exhausted product remains visible for restocking even without a saved threshold.
    state.products[2].lowStockAt = undefined;
    await renderCatalog(state);

    fireEvent.click(screen.getByRole("button", { name: "Por surtir" }));
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla"]);
    expect(screen.getByText("2 de 3 piezas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Por surtir" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByText("Limpiar"));
    expect(cardNames()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Por surtir" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("#344 cuenta también lo que está bajo el umbral POR DEFECTO — igual que la tarjeta de Inicio", async () => {
    // Fer's reported case: existence 2 without a saved threshold counts in
    // Inicio's "Por surtir" card (default 3); the catalog filter used to
    // require an explicit lowStockAt and showed a smaller number.
    const state = sortFilterState();
    state.products[0].lowStockAt = undefined; // Anillo Blossom, qty 5 > default 3
    state.products[1].quantityOnHand = 2;     // anillo perla, no threshold → 2 ≤ 3
    state.products[1].lowStockAt = undefined;
    state.products[2].lowStockAt = undefined; // Aretes Luna, qty −2 → agotada
    await renderCatalog(state);

    fireEvent.click(screen.getByRole("button", { name: "Por surtir" }));
    await waitFor(() => expect(cardNames()).toEqual(["Aretes Luna", "anillo perla"]));
    expect(screen.getByText("2 de 3 piezas")).toBeTruthy();
    // Anillo Blossom (5 existencias, sin umbral) no cuenta en ninguna de las dos superficies.
  });

  it("#365 incluye diseños por color agotados y negativos en Por surtir — con insignia del agregado", async () => {
    const state = sortFilterState();
    state.products = [
      tieredProduct({ id: "healthy", name: "Anillo Blossom", categoryIds: [CAT_ANILLOS], quantityOnHand: 5 }),
      tieredProduct({
        id: "austin",
        name: "Reloj Austin",
        categoryIds: [CAT_ANILLOS],
        quantityOnHand: undefined, // #124: the shelf lives on the colors
        variants: [
          variant("av1", "Cafe", 0),
          variant("av2", "Ivory", 0),
          variant("av3", "Black", 0),
        ],
      }),
      tieredProduct({
        id: "arracadas",
        name: "Arracadas Viento",
        categoryIds: [CAT_ARETES],
        quantityOnHand: undefined,
        variants: [
          variant("rv1", "Dorado", -5),
          variant("rv2", "Plata", 3),
        ],
      }),
      tieredProduct({
        id: "untracked",
        name: "Collar Nube",
        categoryIds: [CAT_BOLSAS],
        quantityOnHand: undefined,
        variants: [variant("uv1", "Perla", undefined)],
      }),
    ];
    const view = await renderCatalog(state);

    fireEvent.click(screen.getByRole("button", { name: "Por surtir" }));
    const names = () => Array.from(view.container.querySelectorAll("h3")).map((h) => h.textContent ?? "");
    await waitFor(() =>
      expect(names()).toEqual(["Arracadas Viento", "Reloj Austin"]) // worst first: −2 antes que 0
    );
    expect(screen.getByText("2 de 4 piezas")).toBeTruthy();
    // La ficha no se contradice: la insignia del agregado (Faltan 2 / Agotado)
    // aparece en la propia tarjeta, igual que en Inicio.
    expect(screen.getByText("Faltan 2")).toBeTruthy();
    expect(screen.getByText("Agotado")).toBeTruthy();
    // Collar Nube (sin rastreo) y Anillo Blossom (sano) quedan fuera.
    expect(screen.queryByText(/Collar Nube/)).toBeNull();
    expect(screen.queryByText(/Anillo Blossom/)).toBeNull();
  });

  it("#461 piezas «sin talla» en un color que ya se vende por talla: la tarjeta las nombra (nunca se pierden a la vista)", async () => {
    const state = sortFilterState();
    state.products = [
      tieredProduct({
        id: "sol", name: "Anillo Sol", categoryIds: [CAT_ANILLOS], quantityOnHand: undefined,
        variants: [
          { id: "vg", color: "Dorado", quantityOnHand: 2, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
            sizes: [{ id: "d6", size: "6", quantityOnHand: 3, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }] },
        ],
      }),
    ];
    await renderCatalog(state);
    // La existencia vendible son las 3 de la talla; las 2 sin talla se dicen aparte.
    expect(screen.getByText(/Existencia: 3 en 1 color/)).toBeTruthy();
    expect(screen.getByText("Sin talla: 2")).toBeTruthy();
  });

  it("limpia Por surtir al cambiar de tienda", async () => {
    const state = sortFilterState();
    state.stores.find((store) => store.id === SANTI)!.type = "on_demand";
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <StoreToggleButton />
        <CatalogScreen />
      </Wrapper>
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Por surtir" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Por surtir" }));
    expect(screen.getByRole("button", { name: "Por surtir" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Cambiar tienda" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar tienda" }));
    expect(screen.getByRole("button", { name: "Por surtir" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("#294 descubrir Estrategia y comparar niveles", () => {
  it("la entrada a Estrategia de precios es visible desde Productos sin expandir nada", async () => {
    await renderCatalog(sortFilterState());
    expect(screen.getByRole("button", { name: /Estrategia de precios/i })).toBeTruthy();
  });

  it("muestra los niveles alineados por fila; un precio ausente se representa como tal (no 0)", async () => {
    const state = sortFilterState();
    // Solo Menudeo configurado: Mayoreo aparece como ausente («—»), nunca $0.
    state.products[0] = { ...state.products[0], prices: { t_retail: 300 } } as Product;
    await renderCatalog(state);
    const card = screen.getByText("Anillo Blossom").closest("div[class*='p-4']");
    expect(card?.textContent).toContain("Menudeo");
    expect(card?.textContent).toContain("$300");
    expect(card?.textContent).toMatch(/Mayoreo\s*—/);
    // p3 con ambos niveles: los dos nombres alineados.
    const card3 = screen.getByText("Aretes Luna").closest("div[class*='p-4']");
    for (const label of ["Menudeo", "Mayoreo"]) expect(card3?.textContent).toContain(label);
  });

  it("#294 r2: un precio BORRADO (0) también es ausente — «Mayoreo —», nunca «Mayoreo $0»", async () => {
    const state = sortFilterState();
    // El formulario persiste el campo vacío como 0; 0 NO es precio (compuerta
    // de publicación, PricingStrategy) — la fila no puede pintarlo legítimo.
    state.products[0] = { ...state.products[0], prices: { t_retail: 300, t_mayoreo: 0 } } as Product;
    await renderCatalog(state);
    const card = screen.getByText("Anillo Blossom").closest("div[class*='p-4']");
    expect(card?.textContent).toMatch(/Mayoreo\s*—/);
    expect(card?.textContent).not.toMatch(/Mayoreo\s*\$0/);
  });

  it("conserva orden y filtros existentes con la nueva fila de precios", async () => {
    await renderCatalog(sortFilterState());
    expect(screen.getByLabelText("Categoría")).toBeTruthy();
    expect(screen.getByLabelText("Ordenar por")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Por surtir" })).toBeTruthy();
  });
});

describe("valores iniciales del producto", () => {
  it("guarda los cambios y al reabrir respeta Borrador, vacío y false", async () => {
    const state = fixtureState();
    state.activeStoreId = OLIVIA;
    await renderCatalog(state);

    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    expect(lastByLabel("Estado de publicación")).toHaveProperty("value", "published");
    expect(lastByLabel("Permite pedir info")).toHaveProperty("checked", true);
    expect(lastByLabel("Novedad")).toHaveProperty("checked", false);
    expect(lastByLabel("Destacado")).toHaveProperty("checked", false);
    expect(lastByLabel("Material")).toHaveProperty("value", "Acero inoxidable");
    expect(lastByLabel("Color / acabado")).toHaveProperty("value", "");

    fireEvent.change(screen.getByLabelText("Estado de publicación"), { target: { value: "draft" } });
    expect(lastByLabel("Estado de publicación")).toHaveProperty("value", "draft");
    fireEvent.click(screen.getByLabelText("Permite pedir info"));
    fireEvent.change(screen.getByLabelText("Material"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Color / acabado"), { target: { value: "Dorado" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Producto de prueba" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Agregar" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("heading", { name: "Producto de prueba" }));
    expect(lastByLabel("Estado de publicación")).toHaveProperty("value", "draft");
    expect(lastByLabel("Permite pedir info")).toHaveProperty("checked", false);
    expect(lastByLabel("Novedad")).toHaveProperty("checked", false);
    expect(lastByLabel("Destacado")).toHaveProperty("checked", false);
    expect(lastByLabel("Material")).toHaveProperty("value", "");
    expect(lastByLabel("Color / acabado")).toHaveProperty("value", "Dorado");
  });

  it("no aplica el material de Olivia al crear en Santi", async () => {
    const state = fixtureState();
    state.activeStoreId = SANTI;
    await renderCatalog(state);

    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    expect(lastByLabel("Material")).toHaveProperty("value", "");
    expect(lastByLabel("Color / acabado")).toHaveProperty("value", "");
  });

  it("al editar un producto existente conserva sus valores guardados", async () => {
    const state = fixtureState();
    const existing = state.products.find((product) => product.id === "prod_olivia_1")!;
    Object.assign(existing, {
      status: "draft",
      canInquire: false,
      isNew: true,
      isFeatured: true,
      material: "Plata 925",
      finish: "",
    });
    await renderCatalog(state);

    fireEvent.click(screen.getByRole("heading", { name: existing.name }));

    expect(lastByLabel("Estado de publicación")).toHaveProperty("value", "draft");
    expect(lastByLabel("Permite pedir info")).toHaveProperty("checked", false);
    expect(lastByLabel("Novedad")).toHaveProperty("checked", true);
    expect(lastByLabel("Destacado")).toHaveProperty("checked", true);
    expect(lastByLabel("Material")).toHaveProperty("value", "Plata 925");
    expect(lastByLabel("Color / acabado")).toHaveProperty("value", "");
  });
});

describe("CatalogScreen orden", () => {
  it("por defecto ordena por fecha, recientes primero", async () => {
    await renderCatalog(sortFilterState());
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
  });

  it("ordena por nombre en ambas direcciones (localeCompare es, sin importar mayúsculas)", async () => {
    const { container } = await renderCatalog(sortFilterState());

    changeSelect("Ordenar por", "name");
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);

    const toggle = within(container).getByLabelText("Orden ascendente");
    fireEvent.click(toggle);
    expect(within(container).getByLabelText("Orden descendente")).toBeTruthy();
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
  });

  it("ordena por precio efectivo del tier default; empates se resuelven por nombre", async () => {
    await renderCatalog(sortFilterState());

    changeSelect("Ordenar por", "price");
    expect(cardNames()).toEqual(["Aretes Luna", "Anillo Blossom", "anillo perla"]);

    fireEvent.click(screen.getByLabelText("Orden ascendente"));
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);
  });

  it("ordena por stock ascendente, negativos y cero primero", async () => {
    await renderCatalog(sortFilterState());

    changeSelect("Ordenar por", "stock");
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
  });
});

describe("CatalogScreen cobertura extra de direcciones y filtro vacío", () => {
  it("cambiar la dirección en el orden por defecto muestra los más antiguos primero", async () => {
    await renderCatalog(sortFilterState());
    fireEvent.click(screen.getByLabelText("Orden descendente"));
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);
  });

  it("orden por stock en descendente: mayores existencias primero", async () => {
    await renderCatalog(sortFilterState());
    changeSelect("Ordenar por", "stock");
    fireEvent.click(screen.getByLabelText("Orden ascendente"));
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);
  });

  it("filtro sin coincidencias muestra 'Sin resultados' y Limpiar restaura", async () => {
    await renderCatalog(sortFilterState());
    changeSelect("Categoría", CAT_BOLSAS);
    expect(screen.getByText("Sin resultados")).toBeTruthy();
    expect(screen.getByText("Ningún producto en esta categoría.")).toBeTruthy();
    expect(cardNames()).toEqual([]);
    fireEvent.click(screen.getByText("Limpiar"));
    expect(cardNames()).toHaveLength(3);
  });
});

describe("CatalogScreen alertas de existencias (FER-09)", () => {
  it("distingue Agotado y Faltan N; umbral explícito pinta Quedan N", async () => {
    const state = sortFilterState();
    // p1 has 5 on hand: below an explicit threshold of 6 → "Quedan 5".
    state.products[0].lowStockAt = 6;
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    // Cloud mount hydrates asynchronously — wait for the first alert.
    expect(await screen.findByText("Quedan 5")).toBeTruthy();
    expect(screen.getByText("Agotado")).toBeTruthy(); // p2: 0 on hand
    expect(screen.getByText("Faltan 2")).toBeTruthy(); // p3: −2 shortage
  });

  it("sin umbral guardado no alerta por encima del default conservador", async () => {
    const state = sortFilterState();
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    // Cloud mount hydrates asynchronously — anchor on an always-present alert
    // before asserting the negative.
    expect(await screen.findByText("Agotado")).toBeTruthy();
    // p1: 5 on hand, no threshold → above the default (3), no alert.
    expect(screen.queryByText(/Quedan/)).toBeNull();
    // Exhausted pieces still alert without any saved threshold.
    expect(screen.getByText("Faltan 2")).toBeTruthy();
  });
});

describe("CatalogScreen en tienda on_demand", () => {
  it("no ofrece la opción Stock y ordena por precio del campo price", async () => {
    const state = sortFilterState();
    state.activeStoreId = SANTI;
    state.products = [
      tieredProduct({ id: "s1", storeId: SANTI, name: "Perfume Alfa", price: 200, prices: undefined, quantityOnHand: undefined, createdAt: "2026-08-01T00:00:00.000Z" }),
      tieredProduct({ id: "s2", storeId: SANTI, name: "Perfume Beta", price: 100, prices: undefined, quantityOnHand: undefined, createdAt: "2026-08-02T00:00:00.000Z" }),
    ];
    await renderCatalog(state);

    const orderSelect = screen.getByLabelText("Ordenar por") as HTMLSelectElement;
    const options = Array.from(orderSelect.options).map((o) => o.value);
    expect(options).not.toContain("stock");

    changeSelect("Ordenar por", "price");
    expect(cardNames()).toEqual(["Perfume Beta", "Perfume Alfa"]);
  });
});


describe("#489 rejected quick stock correction", () => {
  it("shows the failure and keeps the saved quantity when the minus button is rejected", async () => {
    const state = sortFilterState();
    state.products = [tieredProduct({ id: "watch-audit", name: "Reloj prueba", quantityOnHand: 5 })];
    mocks.saveProduct.mockRejectedValueOnce(new Error("permission-denied"));
    await renderCatalog(state);
    fireEvent.click(screen.getByRole("button", { name: "Restar uno" }));
    await screen.findByText("No se pudo actualizar la existencia. Revisa tu conexión e intenta de nuevo.");
    expect(mocks.saveProduct).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Existencia: 5")).toBeTruthy();
  });
});
