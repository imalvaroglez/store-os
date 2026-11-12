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
  it("activar por color: el primer color llega sembrado (sin acabado, sin existencias) y el sufijo se sugiere al nombrarlo; el costo hereda", async () => {
    render(<ProductForm product={{ ...design, cost: 100 }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("Costo"), { target: { value: "100" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    // #355: activating on a simple ficha seeds the FIRST color instead of an empty list.
    const color = screen.getByLabelText("Color");
    expect((color as HTMLInputElement).value).toBe("");
    fireEvent.change(color, { target: { value: "Dorado" } });
    expect((screen.getByLabelText(/Clave \(SOL-/) as HTMLInputElement).value).toBe("D");
    // El costo del color hereda el del diseño.
    expect((screen.getAllByLabelText(/Costo del color/)[0] as HTMLInputElement).value).toBe("100");
  });

  it("publicar con un color sin foto bloquea y dice cuál", async () => {
    render(<ProductForm product={{ ...design, cost: 100, categoryIds: ["c1"] }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
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

describe("#355 — conversión de una ficha existente a venta por color", () => {
  const simpleWatch: Product = {
    ...design,
    cost: 500,
    quantityOnHand: 4,
    lowStockAt: 2,
    finish: "Plateado",
    slug: "reloj-austin",
    images: [{ id: "g1", url: "https://x.test/plata.jpg", storagePath: "p/g1", order: 0, isPrimary: true }],
    imageUrl: "https://x.test/plata.jpg",
    categoryIds: ["c1"],
  };

  it("con piezas capturadas pide confirmación y al aceptar siembra el acabado anterior como primer color con TODO", async () => {
    render(<ProductForm product={simpleWatch} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "800" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    // The dialog explains where the pieces go (they are NOT discarded) and
    // names the finish being carried over.
    expect(await screen.findByText(/4 pieza\(s\) capturadas como pieza única/i)).toBeTruthy();
    expect(screen.getByText(/\(Plateado\) pasan al primer color/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vender por color" }));
    // The seeded first color: finish name, pieces, cost, threshold, gallery.
    expect((screen.getByLabelText("Color") as HTMLInputElement).value).toBe("Plateado");
    expect((screen.getByLabelText(/Clave \(SOL-P\)/) as HTMLInputElement).value).toBe("P");
    expect((screen.getAllByLabelText(/^En existencia$/)[1] as HTMLInputElement).value).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(saved.variants).toHaveLength(1);
    expect(saved.variants![0]).toMatchObject({
      color: "Plateado",
      skuSuffix: "P",
      sku: "SOL-P",
      cost: 500,
      quantityOnHand: 4,
      lowStockAt: 2,
      photos: [{ id: "g1", url: "https://x.test/plata.jpg" }],
    });
    // The design-level shelf is gone and the public route survives untouched.
    expect(saved.quantityOnHand).toBeUndefined();
    expect(saved.slug).toBe("reloj-austin");
  });

  it("cancelar el diálogo deja la ficha como estaba (pieza única)", async () => {
    render(<ProductForm product={simpleWatch} onDone={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    // Still simple: no color cards at all.
    expect(screen.queryByLabelText("Color")).toBeNull();
  });

  it("un segundo color se agrega SIN perder el primero: identidad + existencias por color", async () => {
    // Draft: the second color has no photo yet, which would block PUBLISH —
    // the publish gate itself is covered by the first test.
    render(<ProductForm product={{ ...simpleWatch, status: "draft" }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "800" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    fireEvent.click(await screen.findByRole("button", { name: "Vender por color" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }));
    const colors = screen.getAllByLabelText("Color");
    fireEvent.change(colors[1], { target: { value: "Dorado" } });
    const shelves = screen.getAllByLabelText(/^En existencia$/);
    fireEvent.change(shelves[2], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(saved.variants).toHaveLength(2);
    expect(saved.variants!.map((v) => v.color)).toEqual(["Plateado", "Dorado"]);
    expect(saved.variants![0].quantityOnHand).toBe(4);
    expect(saved.variants![1].quantityOnHand).toBe(2);
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

describe("text-entry-audit · flujo Productos (#219)", () => {
  beforeEach(() => {
    mocks.state = tieredState();
    mocks.upsertProduct.mockReset().mockResolvedValue(undefined);
  });



  it("clave duplicada (mayúsculas/minúsculas) bloquea con mensaje", () => {
    mocks.state!.products = [{ ...design, id: "otro", name: "Otro diseño", sku: "SOL" } as unknown as Product];
    render(<ProductForm product={{ ...design, categoryIds: ["c1"] }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    // Misma clave escrita a mano (minúsculas) contra otro producto de la tienda.
    fireEvent.change(screen.getByLabelText(/Clave \/ SKU/), { target: { value: "sol" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(screen.getByText(/Esa clave ya la usa otro producto/i)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("existencia solo acepta enteros; el nombre vacío no guarda", () => {
    render(<ProductForm product={{ ...design, categoryIds: ["c1"] }} onDone={() => {}} />);
    const qty = screen.getByLabelText("En existencia") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "3.7" } });
    expect(qty.value).toBe("37"); // el punto se descarta en escritura, nunca llega un decimal
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Guardar producto" })).toBeDisabled();
  });
});
