// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProductForm } from "./ProductForm";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";
import type { Product } from "../../types";

const mocks = vi.hoisted(() => ({
  user: null as AppUser | null,
  state: null as ReturnType<typeof fixtureState> | null,
  upsertProduct: vi.fn(),
}));

vi.mock("../../app/firebase/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: mocks.user, authReady: true, enabled: false, error: null, signOut: async () => {} }),
}));
vi.mock("../../app/StoreProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/StoreProvider")>();
  return {
    ...actual,
    useStore: () => ({
      state: mocks.state,
      upsertProduct: mocks.upsertProduct,
      activeStore: mocks.state?.stores.find((s) => s.id === "store_olivia"),
      cloud: false,
    }),
  };
});

const design: Product = {
  id: "design_1",
  storeId: "store_olivia",
  name: "Anillo Sol",
  sku: "SOL",
  category: "other",
  status: "published",
  isPublic: true,
  imageUrl: "https://x.test/cover.jpg",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

function tieredState() {
  const state = fixtureState();
  const store = { ...state.stores[0] } as typeof state.stores[number];
  store.type = "inventory_tiered";
  store.priceTiers = [{ id: "t_retail", label: "Regular", order: 1 }];
  store.defaultTierId = "t_retail";
  state.stores[0] = store;
  state.categories = [{ id: "c1", storeId: "store_olivia", name: "Anillos", active: true, createdAt: "", updatedAt: "" }] as unknown as typeof state.categories;
  return state;
}

beforeEach(() => {
  mocks.state = tieredState();
  mocks.upsertProduct.mockReset().mockResolvedValue(undefined);
});

describe("ProductForm #124 — editor de colores", () => {
  it("activar por color, agregar color: sufijo se sugiere con la inicial y el costo hereda", async () => {
    render(<ProductForm product={{ ...design, cost: 100 }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("Costo"), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }));
    const color = screen.getByLabelText("Color");
    fireEvent.change(color, { target: { value: "Dorado" } });
    expect((screen.getByLabelText(/Clave \(SOL-/) as HTMLInputElement).value).toBe("D");
    // El costo del color hereda el del diseño.
    expect((screen.getAllByLabelText(/Costo del color/)[0] as HTMLInputElement).value).toBe("100");
  });

  it("publicar con un color sin foto bloquea y dice cuál", async () => {
    render(<ProductForm product={{ ...design, cost: 100, categoryIds: ["c1"] }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }));
    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "Dorado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    // Sin cloud, sin foto por color: el mensaje nombra el color.
    await waitFor(() => expect(mocks.upsertProduct).not.toHaveBeenCalled());
    // El error de validación aparece con el nombre del color.
    expect((await screen.findAllByText(/Dorado necesita al menos una foto|necesita su clave|color neces/i)).length).toBeGreaterThan(0);
  });

  it("colores duplicados bloquean la publicación", async () => {
    render(<ProductForm product={{ ...design, cost: 100, categoryIds: ["c1"] }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }));
    const colors = screen.getAllByLabelText("Color");
    fireEvent.change(colors[0], { target: { value: "Dorado" } });
    fireEvent.change(colors[1], { target: { value: "dorado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByText(/Cada color debe tener un nombre distinto/i)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("guardar materializa claves y existencias por color; el campo nivel diseño no se escribe", async () => {
    render(<ProductForm product={{ ...design, cost: 100, categoryIds: ["c1"], status: "draft" }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }));
    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "Dorado" } });
    fireEvent.change(screen.getAllByLabelText(/^En existencia$/)[1], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(saved.variants).toHaveLength(1);
    expect(saved.variants![0]).toMatchObject({ color: "Dorado", skuSuffix: "D", sku: "SOL-D", quantityOnHand: 5 });
    expect(saved.quantityOnHand).toBeUndefined();
  });
});

describe("#124 misión UX — portada derivada del primer color", () => {
  it("publica sin foto propia del diseño: la portada sale del primer color", async () => {
    // cloud=false: fotos por URL. El diseño SIN galería propia, el color CON foto.
    render(
      <ProductForm
        product={{
          ...design,
          cost: 100,
          categoryIds: ["c1"],
          status: "published",
          imageUrl: undefined,
          variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, quantityOnHand: 2, photos: [{ id: "f1", url: "https://x.test/gold.jpg", storagePath: "p/f1", order: 0, isPrimary: true }], createdAt: "", updatedAt: "" }],
        }}
        onDone={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    // Ni "foto de portada" ni "foto del color" bloquean; la portada se derivó.
    expect(saved.imageUrl).toBe("https://x.test/gold.jpg");
    expect(saved.images?.[0]?.url).toBe("https://x.test/gold.jpg");
  });
});
