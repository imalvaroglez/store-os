// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ProductForm } from "./ProductForm";
import { fixtureState } from "../../lib/testFixtures";
import type { AppUser } from "../../app/firebase/auth";
import { StaleProductError } from "../../lib/productMerge";
import type { Product } from "../../types";

const mocks = vi.hoisted(() => ({
  user: null as AppUser | null,
  state: null as ReturnType<typeof fixtureState> | null,
  upsertProduct: vi.fn(),
  cloud: false,
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
      cloud: mocks.cloud,
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
  mocks.cloud = false;
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

  it("desactivar colores devuelve las piezas al estante de diseño (revisable) y el payload pide borrar el array", async () => {
    render(
      <ProductForm
        product={{
          ...design,
          cost: 100,
          categoryIds: ["c1"],
          status: "draft",
          variants: [
            { id: "v1", color: "Dorado", skuSuffix: "D", sku: "SOL-D", quantityOnHand: 2, photos: [{ id: "f1", url: "https://x.test/g.jpg", storagePath: "p/f1", order: 0, isPrimary: true }], createdAt: "", updatedAt: "" },
            { id: "v2", color: "Plateado", skuSuffix: "P", sku: "SOL-P", quantityOnHand: 3, photos: [{ id: "f2", url: "https://x.test/s.jpg", storagePath: "p/f2", order: 0, isPrimary: true }], createdAt: "", updatedAt: "" },
          ],
        }}
        onDone={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText(/Regular/), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText(/Se vende por color/));
    // Colors hold pieces → the disable confirmation is required.
    fireEvent.click(await screen.findByRole("button", { name: "Dejar de vender por color" }));
    // The design-level shelf is pre-filled with the colors' pieces (reviewable).
    expect((screen.getAllByLabelText(/^En existencia$/)[0] as HTMLInputElement).value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    // The payload asks to canonically drop the color array (tombstone for saveEntity).
    expect("variants" in saved).toBe(true);
    expect(saved.variants).toBeUndefined();
    expect(saved.quantityOnHand).toBe(5);
  });

  it("una edición de tienda «Bajo pedido» jamás pide borrar estantes ni colores (regresión revisión #361)", async () => {
    // A store switched to on_demand keeps legacy shelves/colors canonically;
    // a price edit must not tombstone them.
    const onDemandState = tieredState();
    (onDemandState.stores[0] as Record<string, unknown>).type = "on_demand";
    mocks.state = onDemandState;
    render(
      <ProductForm
        product={{ ...design, cost: 100, price: 50, quantityOnHand: 7, categoryIds: ["c1"] }}
        onDone={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText(/Precio/, { selector: "input" }), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect("quantityOnHand" in saved).toBe(false); // property absent: no tombstone
    expect("variants" in saved).toBe(false);
  });

  it("on_demand con variante heredada: el spread inicial tampoco reintroduce lápidas (hueco M2 revisión)", async () => {
    // The spread `...(variantsEnabled ? { variants, quantityOnHand: undefined } : { variants: undefined })`
    // runs for on_demand too when the product CARRIES variants (switched store);
    // the on_demand branch must delete both properties regardless.
    const onDemandState = tieredState();
    (onDemandState.stores[0] as Record<string, unknown>).type = "on_demand";
    mocks.state = onDemandState;
    render(
      <ProductForm
        product={{
          ...design,
          cost: 100,
          price: 50,
          categoryIds: ["c1"],
          quantityOnHand: 3,
          variants: [{ id: "v1", color: "Dorado", skuSuffix: "D", sku: "SOL-D", quantityOnHand: 2, photos: [{ id: "f1", url: "https://x.test/g.jpg", storagePath: "p/f1", order: 0, isPrimary: true }], createdAt: "", updatedAt: "" }],
        }}
        onDone={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText(/Precio/, { selector: "input" }), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect("quantityOnHand" in saved).toBe(false);
    expect("variants" in saved).toBe(false);
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


describe("ProductForm #489 — one stock adjustment per save", () => {
  const watch = { ...design, status: "draft" as const, quantityOnHand: 0, cost: 100, categoryIds: ["c1"] };

  it("locks a save without photos while the stock write is pending", async () => {
    let finish!: () => void;
    mocks.upsertProduct.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const done = vi.fn();
    render(<ProductForm product={watch} onDone={done} />);
    fireEvent.change(screen.getByLabelText(/^En existencia$/), { target: { value: "1" } });
    const save = screen.getByRole("button", { name: "Guardar producto" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.upsertProduct).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(done).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  it("unlocks after a rejected canonical write, keeping the captured count for retry", async () => {
    mocks.upsertProduct.mockRejectedValueOnce(new Error("permission-denied")).mockResolvedValueOnce(watch);
    render(<ProductForm product={watch} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^En existencia$/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await screen.findByText("No se pudo guardar. Intenta de nuevo.");
    expect(screen.getByRole("button", { name: "Guardar producto" })).toBeEnabled();
    expect(screen.getByLabelText(/^En existencia$/)).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(2));
  });
});

describe("#489 inventory availability editor", () => {
  it("uses inventory guidance instead of a conflicting manual availability selector", () => {
    render(<ProductForm product={{ ...design, quantityOnHand: 5, availability: "sold_out" }} onDone={() => {}} />);
    expect(screen.queryByRole("combobox", { name: "Disponibilidad" })).toBeNull();
    expect(screen.getByText(/La disponibilidad se calcula con las existencias/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Estado de publicación" })).toBeTruthy();
  });
});

describe("#489 legacy cover republish (PO decision, 18-nov)", () => {
  const legacy = { ...design, status: "draft" as const, quantityOnHand: 0, cost: 100, prices: { t_retail: 100 }, categoryIds: ["c1"] };

  it("returns a legacy piece with a bare imageUrl to published in cloud without a new photo", async () => {
    mocks.cloud = true;
    render(<ProductForm product={legacy} onDone={() => {}} />);
    await screen.findByLabelText(/^En existencia$/);
    fireEvent.change(screen.getByRole("combobox", { name: "Estado de publicación" }), { target: { value: "published" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Para publicar, agrega una foto de portada.")).toBeNull();
  });

  it("keeps the cover gate in cloud for a piece with no photo at all", async () => {
    mocks.cloud = true;
    const bare = { ...legacy, imageUrl: undefined };
    render(<ProductForm product={bare} onDone={() => {}} />);
    await screen.findByLabelText(/^En existencia$/);
    fireEvent.change(screen.getByRole("combobox", { name: "Estado de publicación" }), { target: { value: "published" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await screen.findByText("Para publicar, agrega una foto de portada.");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });
});

// #461 corte 2 (PO 22-nov, opción A/B): sizes per color in the editor —
// suggested/editable clave, CONFIRMED cost required (zero valid, suggestion
// never counts as confirmation), per-combination count with derived color
// stock, and Disponible/Comprometido/Físico per combination.
describe("ProductForm #461 — tallas por color (corte 2)", () => {
  const photo = { id: "f1", url: "https://x.test/f1.jpg", storagePath: "p/f1", order: 0, isPrimary: true };
  function variantDesign(): Product {
    return {
      ...design,
      cost: 100,
      categoryIds: ["c1"],
      prices: { t_retail: 300 },
      imageUrl: photo.url,
      variants: [
        { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, photos: [photo], quantityOnHand: 3, createdAt: "", updatedAt: "" },
      ],
    } as Product;
  }

  function abrirConTalla(label = "6") {
    render(<ProductForm product={variantDesign()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Talla" }));
    fireEvent.change(screen.getByLabelText(/^Talla$/), { target: { value: label } });
  }

  it("agregar talla: clave sugerida (SOL-D-6) editable y costo VACÍO con el costo del color como sugerencia visible", () => {
    abrirConTalla("6");
    expect((screen.getByLabelText(/Clave de la talla \(SOL-D-/) as HTMLInputElement).value).toBe("6");
    const costo = screen.getByLabelText(/Costo de la talla/) as HTMLInputElement;
    expect(costo.value).toBe(""); // la sugerencia nunca cuenta como confirmación
    expect(costo.placeholder).toBe("100");
  });

  it("cada talla muestra Disponible y Comprometido junto a su Físico editable", () => {
    abrirConTalla("6");
    fireEvent.change(screen.getByLabelText(/^Disponible/), { target: { value: "5" } });
    expect(screen.getByText("Disponible 5 · Comprometido 0 · Físico 5")).toBeTruthy();
  });

  it("con tallas, la existencia del color se deriva (deshabilitada) y el guardado materializa clave y cantidades por combinación", async () => {
    // El color contaba 5 piezas: se reparten 3 y 2 entre sus tallas (dictamen QA, crítico 3).
    const counted = { ...variantDesign(), variants: [{ ...variantDesign().variants![0], quantityOnHand: 5 }] } as Product;
    render(<ProductForm product={counted} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Talla" }));
    fireEvent.change(screen.getByLabelText(/^Talla$/), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText(/^Disponible/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Talla" }));
    const tallas = screen.getAllByLabelText(/^Talla$/);
    fireEvent.change(tallas[1], { target: { value: "7" } });
    const fisicos = screen.getAllByLabelText(/^Disponible/);
    fireEvent.change(fisicos[1], { target: { value: "2" } });
    // Costo confirmado por combinación (la sugerencia nunca cuenta como tal).
    const costos = screen.getAllByLabelText(/Costo de la talla/);
    fireEvent.change(costos[0], { target: { value: "100" } });
    fireEvent.change(costos[1], { target: { value: "100" } });
    // El color ya no acepta existencia propia: muestra la suma derivada — las mismas 5.
    const existencia = screen.getByLabelText(/^En existencia del color/) as HTMLInputElement;
    expect(existencia.disabled).toBe(true);
    expect(existencia.value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    const gold = saved.variants!.find((v) => v.id === "v_gold")!;
    expect(gold.quantityOnHand).toBeUndefined(); // el nivel del color nunca se escribe
    expect(gold.sizes!.map((s) => [s.size, s.sku, s.quantityOnHand, s.cost])).toEqual(
      expect.arrayContaining([["6", "SOL-D-6", 3, 100], ["7", "SOL-D-7", 2, 100]])
    );
  });

  it("guardar exige costo confirmado por combinación: vacío bloquea y nombra la talla; cero confirmado pasa", async () => {
    abrirConTalla("6");
    fireEvent.change(screen.getByLabelText(/Costo de la talla/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByText(/Confirma el costo de la talla 6/i)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Costo de la talla/), { target: { value: "0" } });
    // La talla recibe las 3 piezas que el color ya contaba.
    fireEvent.change(screen.getByLabelText(/^Disponible/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(saved.variants![0].sizes![0].cost).toBe(0); // cero confirmado es válido
  });

  it("tallas repetidas en el color bloquean el guardado", async () => {
    abrirConTalla("6");
    fireEvent.click(screen.getByRole("button", { name: "+ Talla" }));
    fireEvent.change(screen.getAllByLabelText(/^Talla$/)[1], { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByText(/Dorado tiene una talla repetida/i)).toBeTruthy();
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("quitar talla la elimina del color y el color vuelve a existencia directa", () => {
    abrirConTalla("6");
    fireEvent.click(screen.getByRole("button", { name: /Quitar talla 6/i }));
    expect(screen.queryByLabelText(/^Talla$/)).toBeNull();
    // El color vuelve a existencia directa: el único campo con 3 habilitado.
    const existencia = screen.getByDisplayValue("3") as HTMLInputElement;
    expect(existencia.disabled).toBe(false);
  });

  // ── Dictamen QA 23-nov, crítico 3: conservación de las piezas del color ──
  function sizedDesign(colorLevel?: number) {
    return {
      ...variantDesign(),
      variants: [{
        id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, photos: [photo],
        ...(colorLevel !== undefined ? { quantityOnHand: colorLevel } : {}),
        sizes: [
          { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
          { id: "d5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 1, createdAt: "", updatedAt: "" },
        ],
        createdAt: "", updatedAt: "",
      }],
    } as Product;
  }
  const fisicoDe = (label: string) => screen.getAllByLabelText(/^Disponible/)[["6", "5"].indexOf(label)];

  it("activar tallas sobre un color con 5 piezas: el aviso pide repartirlas y no guarda hasta que las tallas sumen 5", async () => {
    const counted = { ...variantDesign(), variants: [{ ...variantDesign().variants![0], quantityOnHand: 5 }] } as Product;
    render(<ProductForm product={counted} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Talla" }));
    fireEvent.change(screen.getByLabelText(/^Talla$/), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText(/Costo de la talla/), { target: { value: "100" } });
    expect(screen.getByRole("status")).toHaveTextContent("El color Dorado tenía 5 piezas contadas sin talla. Repártelas entre sus tallas para guardar (llevas 0 de 5). Revisa las tallas sin cantidad.");
    fireEvent.change(screen.getByLabelText(/^Disponible/), { target: { value: "2" } });
    expect(screen.getByRole("status")).toHaveTextContent("(llevas 2 de 5)");
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El color Dorado tenía 5 piezas contadas sin talla");
    expect(mocks.upsertProduct).not.toHaveBeenCalled(); // antes: guardaba y las 5 se volvían 2
    fireEvent.change(screen.getByLabelText(/^Disponible/), { target: { value: "5" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(saved.variants![0].sizes![0].quantityOnHand).toBe(5);
  });

  it("piezas «sin talla» en un color con tallas: aviso, bloqueo y reparto exacto (2 piezas → la talla 6 pasa de 3 a 5)", async () => {
    render(<ProductForm product={sizedDesign(2)} onDone={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("El color Dorado tiene 2 piezas sin talla");
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2 piezas sin talla");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
    fireEvent.change(fisicoDe("6"), { target: { value: "5" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = mocks.upsertProduct.mock.calls[0][0] as Product;
    expect(saved.variants![0].sizes!.map((s) => s.quantityOnHand)).toEqual([5, 1]);
  });

  it("quitar una talla con piezas pide dejarla en 0; con piezas apartadas en pedidos pide resolver el pedido", async () => {
    render(<ProductForm product={sizedDesign(0)} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar talla 5/i }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La talla 5 del color Dorado todavía tiene 1 pieza");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("la talla que recibió piezas en otro dispositivo detiene el guardado y muestra qué hacer", async () => {
    mocks.upsertProduct.mockRejectedValue(new StaleProductError("La existencia del color Dorado cambió en otro dispositivo mientras editabas. Vuelve a abrir la ficha y reparte sus piezas entre las tallas de nuevo."));
    render(<ProductForm product={sizedDesign()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("existencia del color Dorado cambió en otro dispositivo");
  });

  it("la clave de una talla nueva no puede repetir la de un color o talla de OTRA ficha del catálogo", async () => {
    // Otra ficha de la tienda ya usa SOL-D-6 como clave de una talla (clave completa editada a mano).
    mocks.state!.products.push({
      id: "other", storeId: "store_olivia", name: "Aro Luna", sku: "LUNA", category: "other", isPublic: true, status: "draft",
      variants: [{ id: "vo", color: "Dorado", sku: "LUNA-D", sizes: [{ id: "zo", size: "6", sku: "sol-d-6", cost: 1, quantityOnHand: 0, createdAt: "", updatedAt: "" }], createdAt: "", updatedAt: "" }],
      createdAt: "", updatedAt: "",
    } as unknown as Product);
    try {
      abrirConTalla("6"); // clave sugerida SOL-D-6
      fireEvent.change(screen.getByLabelText(/Costo de la talla/), { target: { value: "100" } });
      fireEvent.change(screen.getByLabelText(/^Disponible/), { target: { value: "3" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("La clave SOL-D-6 ya la usa otra pieza, color o talla del catálogo. Elige otra.");
      expect(mocks.upsertProduct).not.toHaveBeenCalled();
    } finally {
      mocks.state!.products.pop();
    }
  });

  it("Comprometido por talla sale de los pedidos reales (antes siempre 0)", () => {
    mocks.state!.orders = [{
      id: "ord-461-form", storeId: "store_olivia", customerId: "c1", deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
      items: [{ lineId: "l1", productId: "design_1", productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6", quantity: 2, unitPrice: 300, subtotal: 600 }],
      createdAt: "2026-11-23", updatedAt: "2026-11-23",
    }] as unknown as NonNullable<typeof mocks.state>["orders"];
    render(<ProductForm product={sizedDesign()} onDone={() => {}} />);
    // El estante de la talla ya es neto de reservas: Disponible = estante; Físico = estante + comprometido.
    expect(screen.getByText("Disponible 3 · Comprometido 2 · Físico 5")).toBeTruthy(); // talla 6
    expect(screen.getByText("Disponible 1 · Comprometido 0 · Físico 1")).toBeTruthy(); // talla 5
  });

  // ── Revisión de código independiente, 23-nov ──────────────────────────────
  const guardar = () => screen.getByRole("button", { name: "Guardar producto" });
  const payload = () => mocks.upsertProduct.mock.calls[0][0] as Product;

  it("desactivar «Se vende por color» con tallas que tienen piezas pide confirmación y devuelve TODAS las piezas al diseño (3 + 1)", async () => {
    render(<ProductForm product={sizedDesign(0)} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Se vende por color/ }));
    expect(await screen.findByText("¿Dejar de vender por color?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dejar de vender por color" }));
    fireEvent.click(guardar());
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    expect(payload().variants).toBeUndefined();
    expect(payload().quantityOnHand).toBe(4); // antes: 0, las 4 piezas desaparecían
  });

  it("quitar la última talla de un color con piezas «sin talla»: el campo del color muestra el total (1 + 2) y así se guarda", async () => {
    render(<ProductForm product={sizedDesign(2)} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar talla 6/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quitar talla 5/i }));
    const existencia = screen.getByDisplayValue("3") as HTMLInputElement;
    expect(existencia.disabled).toBe(false); // antes mostraba 2 y guardaba 1
    fireEvent.click(guardar());
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    expect(payload().variants![0].sizes ?? []).toEqual([]);
    expect(payload().variants![0].quantityOnHand).toBe(3);
  });

  it("repartir piezas «sin talla» en una talla NUEVA las mueve: se guardan 3 + 1 + 2 y el color queda sin piezas sueltas", async () => {
    render(<ProductForm product={sizedDesign(2)} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Talla" }));
    const last = (label: RegExp) => screen.getAllByLabelText(label).pop()!;
    fireEvent.change(last(/^Talla$/), { target: { value: "7" } });
    fireEvent.change(last(/Costo de la talla/), { target: { value: "100" } });
    fireEvent.change(last(/^Disponible/), { target: { value: "2" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(guardar());
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    const saved = payload().variants![0];
    expect(saved.sizes!.map((size) => [size.size, size.quantityOnHand])).toEqual([["6", 3], ["5", 1], ["7", 2]]);
    // Lo que persiste la transacción (misma regla que al guardar): nada duplicado.
    const { mergeProductOperational } = await import("../../lib/productMerge");
    const persisted = mergeProductOperational(sizedDesign(2), payload(), sizedDesign(2)).variants![0];
    expect(persisted.quantityOnHand).toBeUndefined();
    expect(persisted.sizes!.reduce((total, size) => total + (size.quantityOnHand ?? 0), 0)).toBe(6);
  });

  it("quitar un color que todavía tiene piezas se detiene y dice cuántas", async () => {
    const twoColors = sizedDesign(0) as Product;
    twoColors.variants = [
      ...twoColors.variants!,
      { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "SOL-P", cost: 90, photos: [photo], createdAt: "", updatedAt: "" },
    ];
    render(<ProductForm product={twoColors} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar color Dorado/i }));
    fireEvent.click(guardar());
    expect(await screen.findByRole("alert")).toHaveTextContent("El color Dorado todavía tiene 4 piezas");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("editar el sufijo de una talla ya guardada cambia su clave al guardar", async () => {
    render(<ProductForm product={sizedDesign(0)} onDone={() => {}} />);
    const claves = screen.getAllByLabelText(/Clave de la talla/);
    fireEvent.change(claves[0], { target: { value: "SEIS" } });
    fireEvent.click(guardar());
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    expect(payload().variants![0].sizes![0]).toMatchObject({ skuSuffix: "SEIS", sku: "SOL-D-SEIS" }); // antes: sku "SOL-D-6" sin cambiar
  });

  it("la ficha unificada se guarda: la clave que tomó de su origen fusionado no choca con él", async () => {
    const unified = sizedDesign(0) as Product;
    const first = unified.variants![0].sizes![0];
    unified.variants![0].sizes![0] = { ...first, sku: "SOL-X-7", skuSuffix: undefined };
    mocks.state!.products.push({
      id: "origin", storeId: "store_olivia", name: "Anillo Luna Dorado 7", sku: "SOL-X-7", category: "other", isPublic: false, status: "archived",
      mergedInto: { productId: unified.id, variantId: "v_gold", sizeId: unified.variants![0].sizes![0].id, at: "" },
      variants: [], createdAt: "", updatedAt: "",
    } as unknown as Product);
    try {
      render(<ProductForm product={unified} onDone={() => {}} />);
      fireEvent.click(guardar());
      await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
      expect(payload().variants![0].sizes![0].sku).toBe("SOL-X-7");
    } finally {
      mocks.state!.products.pop();
    }
  });

  // ── Re-revisión 23-nov (menores N1, N8, N10) ──────────────────────────────
  it("N1: no se puede quitar la última talla si tiene piezas apartadas en pedidos", async () => {
    mocks.state!.orders = [{
      id: "ord-461-hold", storeId: "store_olivia", customerId: "c1", deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid",
      items: [{ lineId: "l1", productId: "design_1", productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6", quantity: 1, unitPrice: 300, subtotal: 300 }],
      createdAt: "2026-11-23", updatedAt: "2026-11-23",
    }] as unknown as NonNullable<typeof mocks.state>["orders"];
    const oneTalla = { ...sizedDesign(0), variants: [{ ...sizedDesign(0).variants![0], sizes: [sizedDesign(0).variants![0].sizes![0]] }] } as Product;
    render(<ProductForm product={oneTalla} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar talla 6/i }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar producto/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La talla 6 del color Dorado tiene piezas apartadas en pedidos");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("N8: una ficha origen ya fusionada no se puede volver a publicar", async () => {
    const merged = { ...variantDesign(), status: "draft" as const, mergedInto: { productId: "main", variantId: "v", sizeId: "z", at: "" } } as Product;
    render(<ProductForm product={merged} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Estado de publicación/), { target: { value: "published" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar producto/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta ficha está fusionada en otra");
    expect(mocks.upsertProduct).not.toHaveBeenCalled();
  });

  it("N10: renombrar la etiqueta de una talla con clave heredada (de una ficha fusionada) no le inventa sufijo ni cambia su clave", async () => {
    const inherited = sizedDesign(0) as Product;
    const first = inherited.variants![0].sizes![0];
    inherited.variants![0].sizes![0] = { ...first, sku: "SOL-X-6", skuSuffix: undefined };
    render(<ProductForm product={inherited} onDone={() => {}} />);
    fireEvent.change(screen.getAllByLabelText(/^Talla$/)[0], { target: { value: "6.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar producto/ }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    expect(payload().variants![0].sizes![0]).toMatchObject({ size: "6.5", sku: "SOL-X-6" });
    expect(payload().variants![0].sizes![0].skuSuffix).toBeUndefined();
  });

  it("M1: corregir la etiqueta de una talla normal ya guardada SÍ actualiza su clave (6 → 6.5)", async () => {
    // Una talla guardada desde el editor trae clave y sufijo sugerido de su etiqueta.
    const saved = sizedDesign(0) as Product;
    const first = saved.variants![0].sizes![0];
    saved.variants![0].sizes![0] = { ...first, skuSuffix: "6" };
    render(<ProductForm product={saved} onDone={() => {}} />);
    fireEvent.change(screen.getAllByLabelText(/^Talla$/)[0], { target: { value: "6.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar producto/ }));
    await waitFor(() => expect(mocks.upsertProduct).toHaveBeenCalledTimes(1));
    expect(payload().variants![0].sizes![0]).toMatchObject({ size: "6.5", skuSuffix: "6.5", sku: "SOL-D-6.5" });
  });
});
