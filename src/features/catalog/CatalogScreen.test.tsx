import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { StoreProvider } from "../../app/StoreProvider";
import { AuthProvider } from "../../app/firebase/AuthProvider";
import { ToastProvider } from "../../design-system";
import { CatalogScreen } from "./CatalogScreen";
import { fixtureState } from "../../lib/testFixtures";
import type { AppState, Product } from "../../types";
import { saveState } from "../../lib/storage";

// Same runtime-mount pattern as src/app/App.test.tsx: save the exact state so
// the provider loads it, then mount the screen under the real providers
// (AuthProvider stays pure-local without VITE_FIREBASE_* in the test env).
function withState(state: AppState) {
  saveState(state);
  return ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>
      <StoreProvider>
        <ToastProvider>{children}</ToastProvider>
      </StoreProvider>
    </AuthProvider>
  );
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

beforeEach(() => {
  localStorage.clear();
});

describe("CatalogScreen filtro por categoría real", () => {
  it("filtra por categoría activa, muestra 'N de M piezas' y Limpiar restaura", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    changeSelect("Categoría", CAT_ANILLOS);
    // Filter keeps the active sort (default: Fecha, recientes primero).
    expect(cardNames()).toEqual(["anillo perla", "Anillo Blossom"]);
    expect(screen.getByText("2 de 3 piezas")).toBeTruthy();

    fireEvent.click(screen.getByText("Limpiar"));
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
    expect(screen.queryByText("Limpiar")).toBeNull();
  });
});

describe("CatalogScreen orden", () => {
  it("por defecto ordena por fecha, recientes primero", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
  });

  it("ordena por nombre en ambas direcciones (localeCompare es, sin importar mayúsculas)", () => {
    const Wrapper = withState(sortFilterState());
    const { container } = render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    changeSelect("Ordenar por", "name");
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);

    const toggle = within(container).getByLabelText("Orden ascendente");
    fireEvent.click(toggle);
    expect(within(container).getByLabelText("Orden descendente")).toBeTruthy();
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
  });

  it("ordena por precio efectivo del tier default; empates se resuelven por nombre", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    changeSelect("Ordenar por", "price");
    expect(cardNames()).toEqual(["Aretes Luna", "Anillo Blossom", "anillo perla"]);

    fireEvent.click(screen.getByLabelText("Orden ascendente"));
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);
  });

  it("ordena por stock ascendente, negativos y cero primero", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    changeSelect("Ordenar por", "stock");
    expect(cardNames()).toEqual(["Aretes Luna", "anillo perla", "Anillo Blossom"]);
  });
});

describe("CatalogScreen cobertura extra de direcciones y filtro vacío", () => {
  it("cambiar la dirección en el orden por defecto muestra los más antiguos primero", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );
    fireEvent.click(screen.getByLabelText("Orden descendente"));
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);
  });

  it("orden por stock en descendente: mayores existencias primero", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );
    changeSelect("Ordenar por", "stock");
    fireEvent.click(screen.getByLabelText("Orden ascendente"));
    expect(cardNames()).toEqual(["Anillo Blossom", "anillo perla", "Aretes Luna"]);
  });

  it("filtro sin coincidencias muestra 'Sin resultados' y Limpiar restaura", () => {
    const Wrapper = withState(sortFilterState());
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );
    changeSelect("Categoría", CAT_BOLSAS);
    expect(screen.getByText("Sin resultados")).toBeTruthy();
    expect(screen.getByText("Ningún producto en esta categoría.")).toBeTruthy();
    expect(cardNames()).toEqual([]);
    fireEvent.click(screen.getByText("Limpiar"));
    expect(cardNames()).toHaveLength(3);
  });
});

describe("CatalogScreen en tienda on_demand", () => {
  it("no ofrece la opción Stock y ordena por precio del campo price", () => {
    const state = sortFilterState();
    state.activeStoreId = SANTI;
    state.products = [
      tieredProduct({ id: "s1", storeId: SANTI, name: "Perfume Alfa", price: 200, prices: undefined, quantityOnHand: undefined, createdAt: "2026-08-01T00:00:00.000Z" }),
      tieredProduct({ id: "s2", storeId: SANTI, name: "Perfume Beta", price: 100, prices: undefined, quantityOnHand: undefined, createdAt: "2026-08-02T00:00:00.000Z" }),
    ];
    const Wrapper = withState(state);
    render(
      <Wrapper>
        <CatalogScreen />
      </Wrapper>
    );

    const orderSelect = screen.getByLabelText("Ordenar por") as HTMLSelectElement;
    const options = Array.from(orderSelect.options).map((o) => o.value);
    expect(options).not.toContain("stock");

    changeSelect("Ordenar por", "price");
    expect(cardNames()).toEqual(["Perfume Beta", "Perfume Alfa"]);
  });
});
