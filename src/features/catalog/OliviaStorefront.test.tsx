import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { OliviaStorefront } from "./OliviaStorefront";
import { OLIVIA_CONTENT } from "../../lib/oliviaContent";
import { PublicCatalogNotFoundError, PublicCatalogUnpublishedError } from "../../app/firebase/publicCatalog";
import type {
  PublicStore,
  PublicCatalog,
  PublicProductDetail,
} from "../../app/firebase/publicCatalog";
import type { RouteMatch } from "../../lib/router";
import type { Storefront } from "../../types";

// The storefront loads its data from the anonymous public-catalog loaders; the
// tests mock that module (no Firebase in jsdom) with a 3-tier Olivia fixture
// carrying the owner's numbers: Regular $140 / Girly $120 (desde 5) / Iconic
// $90 (desde $1,000 a precio Iconic).
const mocks = vi.hoisted(() => ({
  loadPublicCatalog: vi.fn(),
  // #286: independent store/catalog mocks so race tests can reject each read
  // in a chosen order; the defaults keep deriving from the shared fixture so
  // every existing mockResolvedValue keeps working.
  loadPublicStore: vi.fn(),
  loadPublicCatalogSummary: vi.fn(),
  loadPublicProduct: vi.fn(),
  saveStorefront: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("../../design-system", async (importOriginal) => ({
  ...await importOriginal<object>(),
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() }),
}));
vi.mock("../../app/firebase/publicCatalog", () => ({
  loadPublicCatalog: mocks.loadPublicCatalog,
  loadPublicStore: mocks.loadPublicStore,
  loadPublicCatalogSummary: mocks.loadPublicCatalogSummary,
  loadPublicProduct: mocks.loadPublicProduct,
  PublicCatalogNotFoundError: class PublicCatalogNotFoundError extends Error {
    constructor(public slug: string) {
      super(`No hay catálogo público para "${slug}".`);
    }
  },
  PublicCatalogUnpublishedError: class PublicCatalogUnpublishedError extends Error {
    constructor(public slug: string) {
      super(`El catálogo de "${slug}" aún no está publicado.`);
    }
  },
}));

const store: PublicStore = {
  storeId: "store_olivia",
  slug: "olivia",
  name: "Olivia",
  type: "inventory_tiered",
  whatsappPhone: "5213344836691",
  priceTiers: [
    { id: "t_retail", label: "Regular", order: 0 },
    { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
    { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
  ],
  defaultTierId: "t_retail",
};

const catalog: PublicCatalog = {
  categories: [{ id: "c1", name: "Anillos", slug: "anillos", sortOrder: 0 }],
  products: [
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "anillo-blossom", name: "Anillo Blossom", finish: "Dorado", categoryIds: ["c1"], price: 140, prices: { t_retail: 140, t_girly: 120, t_iconic: 90 }, stockSignal: "disponible", sku: "AAN1385" },
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "aretes-luna", name: "Aretes Luna", finish: "Plateado", categoryIds: ["c1"], price: 120, prices: { t_retail: 120, t_girly: 100, t_iconic: 80 }, stockSignal: "pocas", sku: "OLI-002" },
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "collar-vega", name: "Collar Vega", price: 200, prices: { t_retail: 200, t_girly: 170, t_iconic: 150 }, stockSignal: "agotado", sku: "OLI-003" },
  ] as PublicCatalog["products"],
};

const detail: PublicProductDetail = {
  storeId: "store_olivia",
  storeSlug: "olivia",
  productSlug: "anillo-blossom",
  name: "Anillo Blossom",
  sku: "AAN1385",
  images: [],
  categories: [],
  price: 140,
  prices: { t_retail: 140, t_girly: 120, t_iconic: 90 },
  stockSignal: "pocas",
};

const storeRoute: RouteMatch = { name: "public_store", params: { slug: "olivia" } };
const productRoute: RouteMatch = {
  name: "public_product",
  params: { slug: "olivia", productSlug: "anillo-blossom" },
};
const categoryRoute: RouteMatch = {
  name: "public_category",
  params: { slug: "olivia", categorySlug: "anillos" },
};

const cartKey = "store-os:cart:olivia";

async function renderStore(editor?: { storeId: string; storefront: Storefront; save: (storeId: string, storefront: Storefront) => Promise<void>; notifySuccess: (message: string) => void; notifyError: (message: string) => void }) {
  const view = render(<OliviaStorefront route={storeRoute} editor={editor} />);
  await screen.findAllByRole("article");
  return view;
}

async function addFromDetail(view: ReturnType<typeof render>, index: number) {
  const product = catalog.products[index];
  mocks.loadPublicProduct.mockResolvedValue({ store, product: { ...detail, ...product, images: [], categories: [] } });
  view.rerender(<OliviaStorefront route={{ name: "public_product", params: { slug: "olivia", productSlug: product.productSlug } }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agregar al carrito" }));
  expect(screen.getByRole("group", { name: `Cantidad de ${product.name}` })).toHaveTextContent("1");
  view.rerender(<OliviaStorefront route={storeRoute} />);
  await screen.findAllByRole("article");
}

async function openDrawer() {
  fireEvent.click(await screen.findByRole("button", { name: "Abrir pedido" }));
  await screen.findByText("Tu pedido");
}

beforeEach(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      get length() { return entries.size; },
      clear: () => entries.clear(),
      getItem: (key: string) => entries.get(key) ?? null,
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      removeItem: (key: string) => entries.delete(key),
      setItem: (key: string, value: string) => entries.set(key, String(value)),
    } });
  }
  localStorage.clear();
  mocks.saveStorefront.mockReset().mockResolvedValue(undefined);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.loadPublicCatalog.mockReset().mockResolvedValue({ store, catalog });
  // Defaults derive from the shared fixture; race tests override per-call
  // with mockRejectedValueOnce / a deferred mockImplementationOnce (#286).
  mocks.loadPublicStore.mockReset().mockImplementation(async () => (await mocks.loadPublicCatalog()).store);
  mocks.loadPublicCatalogSummary.mockReset().mockImplementation(async () => (await mocks.loadPublicCatalog()).catalog);
  mocks.loadPublicProduct.mockReset().mockResolvedValue({ product: detail, store });
});

// #291: the 'filtra por acabado' flake (2nd CI occurrence) matched a stale
// article from a previous test's mount surviving in document.body — an
// unfiltered grid plus the filtered one. Explicit per-file cleanup makes
// cross-test DOM bleed structurally impossible, whatever made the auto
// cleanup miss once on a loaded CI runner.
afterEach(() => { cleanup(); });

describe("filtro por acabado", () => {
  it("no muestra un selector cuando solo hay un acabado", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [catalog.products[0]] } });
    render(<OliviaStorefront route={categoryRoute} />);
    await screen.findByRole("article", { name: "Anillo Blossom" });
    expect(screen.queryByLabelText("Acabado")).toBeNull();
  });

  it("filtra por acabado sin repetirlo en cada tarjeta", async () => {
    // #291: scoped to THIS render's container so a stale mount from another
    // test can never satisfy or defeat the query (the 2nd CI flake signature:
    // the previous test's single-product grid persisting unfiltered).
    const view = render(<OliviaStorefront route={categoryRoute} />);
    const grid = within(view.container);
    await grid.findByRole("article", { name: "Anillo Blossom" });
    expect(grid.getByLabelText("Acabado")).toBeTruthy();
    fireEvent.change(grid.getByLabelText("Acabado"), { target: { value: "plateado" } });
    expect(grid.getByRole("article", { name: "Aretes Luna" })).toBeTruthy();
    // The list re-renders asynchronously after the filter change — wait for the
    // filtered-out card to leave the DOM instead of asserting synchronously.
    // #252: CI runners can take longer than the default 1s to settle that
    // re-render; an explicit generous timeout removes the flake without
    // weakening the assertion.
    await waitFor(() => expect(grid.queryByRole("article", { name: "Anillo Blossom" })).toBeNull(), { timeout: 5000 });
  });
});

describe("#286 la tienda es la señal autoritativa", () => {
  /** Settles when the test decides — controls WHICH read classifies first. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it("catálogo falla primero y la tienda 404a después: gana 'Tienda no encontrada'", async () => {
    const storeRead = deferred<PublicStore>();
    mocks.loadPublicStore.mockImplementationOnce(() => storeRead.promise);
    mocks.loadPublicCatalogSummary.mockRejectedValueOnce(new Error("Firestore REST 503"));
    render(<OliviaStorefront route={storeRoute} />);
    // Interim verdict while the store is still in flight: the catalog spoke.
    expect(await screen.findByText("No se pudo cargar")).toBeTruthy();
    // The store doc settles LAST and overrides — it is the existence signal.
    storeRead.reject(new PublicCatalogNotFoundError("olivia"));
    expect(await screen.findByText("Tienda no encontrada")).toBeTruthy();
    expect(screen.queryByText(/No se pudo cargar/)).toBeNull();
  });

  it("tienda 404a primero: el fallo tardío del catálogo no pisa 'Tienda no encontrada'", async () => {
    mocks.loadPublicStore.mockRejectedValueOnce(new PublicCatalogNotFoundError("olivia"));
    const catalogRead = deferred<PublicCatalog>();
    mocks.loadPublicCatalogSummary.mockImplementationOnce(() => catalogRead.promise);
    render(<OliviaStorefront route={storeRoute} />);
    expect(await screen.findByText("Tienda no encontrada")).toBeTruthy();
    catalogRead.reject(new Error("Firestore REST 503"));
    // A rejection cascade must not flip the verdict back to "failed".
    await waitFor(() => expect(screen.getByText("Tienda no encontrada")).toBeTruthy());
    expect(screen.queryByText(/No se pudo cargar/)).toBeNull();
  });

  it("tienda ok + catálogo sin publicar: mensaje honesto, sin bucle de reintento", async () => {
    mocks.loadPublicCatalogSummary.mockRejectedValueOnce(new PublicCatalogUnpublishedError("olivia"));
    render(<OliviaStorefront route={storeRoute} />);
    expect(await screen.findByText("Catálogo no disponible por ahora")).toBeTruthy();
    expect(screen.getByText(/todavía no publica sus piezas/)).toBeTruthy();
    // A clienta with a fine connection must never read "revisa tu conexión",
    // and an unpublished catalog has nothing to reload.
    expect(screen.queryByText(/Revisa tu conexión/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("tienda ok + fallo de red del catálogo: 'No se pudo cargar' CON Reintentar", async () => {
    mocks.loadPublicCatalogSummary.mockRejectedValueOnce(new Error("Firestore REST 503"));
    render(<OliviaStorefront route={storeRoute} />);
    expect(await screen.findByText("No se pudo cargar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});

describe("tarjetas — jerarquía de precios", () => {
  it("muestra un solo precio desde y deja condiciones y selección en el detalle", async () => {
    await renderStore();
    const card = screen.getByRole("article", { name: "Anillo Blossom" });
    expect(within(card).getByText("Desde $90")).toBeTruthy();
    expect(within(card).queryByText("Regular")).toBeNull();
    expect(within(card).queryByText("Girly")).toBeNull();
    expect(within(card).queryByText("Iconic")).toBeNull();
    expect(within(card).queryByRole("button", { name: /precio|Agregar/ })).toBeNull();
    expect(within(card).getByRole("link", { name: "Anillo Blossom" })).toHaveAttribute("href", "/catalogo/olivia/producto/anillo-blossom");
    expect(screen.getAllByText("Precios por nivel. Condiciones en el detalle de cada pieza.")).toHaveLength(1);
  });

  it.each([
    [{ t_retail: 140, t_girly: 140, t_iconic: 140 }, 140, "$140"],
    [{ t_retail: 0, t_girly: 0, t_iconic: 0 }, 0, "$0"],
    [undefined, 140, "$140"],
  ])("no anuncia variación cuando solo hay un importe (%j)", async (prices, price, expected) => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [{ ...catalog.products[0], price, prices }] } });
    await renderStore();
    expect(within(screen.getByRole("article")).getByText(expected)).toBeTruthy();
    expect(within(screen.getByRole("article")).queryByText(/Desde/)).toBeNull();
  });

  it("uses the actual lowest public tier for Desde and never invents a missing price", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [
      { ...catalog.products[0], prices: { t_retail: 140, t_girly: 80, t_iconic: 90 } },
      { ...catalog.products[1], price: undefined, prices: undefined },
    ] } });
    await renderStore();
    expect(within(screen.getByRole("article", { name: "Anillo Blossom" })).getByText("Desde $80")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Aretes Luna" })).getByText("Consultar precio")).toBeTruthy();
  });

  it("shows a lone public tier with its condition instead of inventing a default price", async () => {
    const partial = { ...detail, price: undefined, prices: { t_iconic: 90 } };
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [{ ...catalog.products[0], ...partial }] } });
    const view = await renderStore();
    expect(within(screen.getByRole("article")).getByText("Desde $90")).toBeTruthy();
    mocks.loadPublicProduct.mockResolvedValue({ store, product: partial });
    view.rerender(<OliviaStorefront route={productRoute} />);
    const prices = await screen.findByRole("region", { name: "Precios por pieza" });
    expect(within(prices).getByText("$90")).toBeTruthy();
    expect(within(prices).queryByText("$0")).toBeNull();
    // 1.13.1: la condición del nivel único es visible, sin «?».
    expect(within(prices).getByText("Con beneficio vigente")).toBeTruthy();
  });

  it.each([
    [{ wholesale: 1 }, "Consultar precio"],
    [{ retail: 140, wholesale: 1 }, "$140"],
  ])("retains the explicit legacy retail fallback without showing unconfigured wholesale (%j)", async (prices, expected) => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [{ ...catalog.products[0], price: undefined, prices }] } });
    await renderStore();
    const card = screen.getByRole("article");
    expect(within(card).getByText(expected)).toBeTruthy();
    expect(within(card).queryByText("$1")).toBeNull();
  });

});

describe("portada — acceso visual por categoría", () => {
  it("usa la foto configurada y, si falta, la primera foto pública de una pieza", async () => {
    const visualCatalog: PublicCatalog = {
      categories: [
        { id: "c1", name: "Anillos", slug: "anillos", imageUrl: "/anillos-cover.jpg", sortOrder: 0 },
        { id: "c2", name: "Aretes", slug: "aretes", sortOrder: 1 },
        { id: "c3", name: "Collares", slug: "collares", sortOrder: 2 },
      ],
      products: [
        { ...catalog.products[0], categoryIds: ["c1"], images: [{ url: "/pieza-anillo.jpg" }] },
        { ...catalog.products[1], categoryIds: ["c2"], imageUrl: "/pieza-arete.jpg" },
        { ...catalog.products[2], categoryIds: ["c3"] },
      ],
    };
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: visualCatalog });
    render(<OliviaStorefront route={storeRoute} />);

    const rings = await screen.findByRole("link", { name: /Anillos.*1 pieza/ });
    expect(rings).toHaveAttribute("href", "/catalogo/olivia/categoria/anillos");
    expect(rings.querySelector("img")).toHaveAttribute("src", "/anillos-cover.jpg");
    const earrings = screen.getByRole("link", { name: /Aretes.*1 pieza/ });
    expect(earrings.querySelector("img")).toHaveAttribute("src", "/pieza-arete.jpg");
    const necklaces = screen.getByRole("link", { name: /Collares.*1 pieza/ });
    expect(within(necklaces).getByRole("img", { name: "Imagen de Collares no disponible" })).toBeTruthy();
  });

  it("omite categorías sin piezas visibles cuando la tienda oculta los agotados", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, storefront: { showSoldOut: false } },
      catalog: {
        categories: [catalog.categories[0], { id: "c3", name: "Collares", slug: "collares", sortOrder: 1 }],
        products: [{ ...catalog.products[0], categoryIds: ["c1"] }, { ...catalog.products[2], categoryIds: ["c3"] }],
      },
    });
    render(<OliviaStorefront route={storeRoute} />);

    expect(await screen.findByRole("link", { name: /Anillos.*1 pieza/ })).toBeTruthy();
    expect(document.querySelector('.olv-category-grid a[href$="collares"]')).toBeNull();
  });
});

describe("edición pública in-place", () => {
  it("does not expose controls to anonymous visitors", async () => {
    await renderStore();
    expect(screen.queryByRole("button", { name: "Editar sitio" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar Título principal/ })).toBeNull();
  });

  it("lets only the owner edit, saves the draft and keeps it visible", async () => {
    await renderStore({ storeId: "store_olivia", storefront: { hero: { body: "Antes" } }, save: mocks.saveStorefront, notifySuccess: mocks.toastSuccess, notifyError: mocks.toastError });
    fireEvent.click(await screen.findByRole("button", { name: "Editar sitio" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Mensaje principal" }));
    fireEvent.change(screen.getByLabelText("Mensaje principal"), { target: { value: "Texto actualizado" } });
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/ }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Sitio público actualizado"));
    expect(mocks.saveStorefront).toHaveBeenCalledWith("store_olivia", expect.objectContaining({ hero: { body: "Texto actualizado" } }));
    expect(screen.getByText("Texto actualizado")).toBeTruthy();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("keeps the draft visible after a failed save and allows retry", async () => {
    mocks.saveStorefront.mockRejectedValueOnce(new Error("offline"));
    await renderStore({ storeId: "store_olivia", storefront: {}, save: mocks.saveStorefront, notifySuccess: mocks.toastSuccess, notifyError: mocks.toastError });
    fireEvent.click(await screen.findByRole("button", { name: "Editar sitio" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Mensaje principal" }));
    fireEvent.change(screen.getByLabelText("Mensaje principal"), { target: { value: "Texto pendiente" } });
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByText("Texto pendiente")).toBeTruthy();
    expect(screen.getByText("Estás editando tu sitio público")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/ }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Sitio público actualizado"));
  });

  // #332 (1.13.1): Fer's reported flow — open Editar sitio, find the delivery
  // controls, change both texts. Clearing must travel as "" so the save can
  // delete the remote field; undefined would resurrect the old value.
  it("edita entregas y horarios; borrar viaja como \"\", y horarios vacíos no se publican", async () => {
    await renderStore({ storeId: "store_olivia", storefront: { shipping: "Envíos viejos", hours: "Lunes a viernes", notice: "Aviso viejo" }, save: mocks.saveStorefront, notifySuccess: mocks.toastSuccess, notifyError: mocks.toastError });
    fireEvent.click(await screen.findByRole("button", { name: "Editar sitio" }));

    fireEvent.click(screen.getByRole("button", { name: "Editar Entregas y envíos" }));
    fireEvent.change(screen.getByLabelText("Entregas y envíos"), { target: { value: "Entregas en punto medio" } });
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Horarios" }));
    fireEvent.change(screen.getByLabelText("Horarios"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Aviso" }));
    fireEvent.change(screen.getByLabelText("Aviso"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));

    fireEvent.click(screen.getByRole("button", { name: /^Guardar$/ }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Sitio público actualizado"));
    expect(mocks.saveStorefront).toHaveBeenCalledWith("store_olivia", expect.objectContaining({
      shipping: "Entregas en punto medio",
      hours: "", // nunca undefined: el guardado debe poder borrar el campo
      notice: "", // ídem Aviso — la aceptación de la spec es por campo (#332)
    }));
    expect(screen.getByText("Entregas en punto medio")).toBeTruthy();
    expect(screen.queryByText(/Horarios:/)).toBeNull(); // vacío → no se publica
  });
});

describe("carrito del storefront — acumular y pedir", () => {
  it("agrega desde detalles, muestra el contador y arma UN mensaje con todas las líneas", async () => {
    const view = await renderStore();
    expect(screen.getByRole("img", { name: "Logo de Olivia" })).toHaveAttribute("src", "/images/olivia-logo.png");
    expect(screen.getByText("Quedan pocas")).toBeTruthy();
    expect(screen.getByText("Agotado")).toBeTruthy();
    await addFromDetail(view, 0);
    expect(screen.getByRole("status")).toHaveTextContent("Agregado a tu pedido");
    await addFromDetail(view, 1);

    const open = screen.getByRole("button", { name: "Abrir pedido" });
    expect(open.textContent).toContain("2");
    expect(open.textContent).toContain("Ver pedido");

    await openDrawer();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Anillo Blossom")).toBeTruthy();
    expect(within(list).getByText("Aretes Luna")).toBeTruthy();
    expect(within(list).getAllByText("Precio por pieza")).toHaveLength(2);
    expect(within(list).getAllByText("Subtotal")).toHaveLength(2);
    // 1.13.1: las líneas muestran centavos, igual que el titular.
    expect(within(list).getAllByText("$140.00")).toHaveLength(2);
    expect(within(list).getAllByText("$120.00")).toHaveLength(2);

    const send = screen.getByRole("link", { name: "Enviar solicitud por WhatsApp" }) as HTMLAnchorElement;
    expect(send.href).toContain("wa.me/5213344836691");
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("Pedido:");
    expect(text).toContain("• 1× Anillo Blossom");
    expect(text).toContain("• 1× Aretes Luna");
    expect(text).not.toContain("AAN1385");
    expect(text).not.toContain("OLI-002");
    expect(text).toContain("/catalogo/olivia");
    // #305: dos cifras etiquetadas como estimación; ambas piezas comparten la
    // única categoría del fixture → sin encabezado de grupo.
    expect(text).toContain("*2 piezas en total*");
    expect(text).toContain("Subtotal estimado: $260.00 MXN");
    expect(text).toContain("¿Eres Iconic? Subtotal estimado: $170.00 MXN"); // 90 + 80
    expect(text).toContain("sujetos a confirmación");

    // 1.13.1: un solo aviso común junto a los estimados, nada repetido bajo
    // la acción; nombre sin etiqueta visual pero con nombre accesible.
    const dialog = screen.getByRole("dialog", { name: "Tu pedido" });
    expect(within(dialog).getAllByText(/Los precios son estimados\./)).toHaveLength(1);
    expect(within(dialog).getByText(/Tu selección no reserva las piezas/)).toBeTruthy();
    expect(within(dialog).queryByText(/Enviar tu selección no confirma ni reserva/)).toBeNull();
    const nameField = within(dialog).getByLabelText("Tu nombre");
    expect(nameField).toHaveAttribute("placeholder", "Escribe tu nombre para identificarte");
  });

  it("stepper ± actualiza líneas y reduce a cero para quitar", async () => {
    const view = await renderStore();
    await addFromDetail(view, 0);
    await openDrawer();

    const list = screen.getByRole("list");
    const row = within(list).getByText("Anillo Blossom").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Sumar una pieza de Anillo Blossom" }));
    expect(within(row).getByText("2")).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Tu pedido" })).getByText("2 piezas")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Quitar" })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Restar una pieza de Anillo Blossom" }));
    fireEvent.click(within(row).getByRole("button", { name: "Restar una pieza de Anillo Blossom" }));
    expect(screen.getByText("Tu pedido está vacío")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir pedido" })).toBeNull();
  });

  it("el carrito sobrevive la recarga (localStorage por tienda)", async () => {
    const first = await renderStore();
    await addFromDetail(first, 0);
    first.unmount();

    render(<OliviaStorefront route={storeRoute} />);
    const open = await screen.findByRole("button", { name: "Abrir pedido" });
    expect(open.textContent).toContain("1");
    expect(JSON.parse(localStorage.getItem(cartKey)!).lines).toHaveLength(1);
  });
});

describe("carrito — leyendas de stock (señal gruesa, nunca cifras)", () => {
  it("pocas → invitación a ordenar; agotado → sobre pedido en la línea del mensaje", async () => {
    const view = await renderStore();
    await addFromDetail(view, 1); // Aretes Luna: low stock
    await addFromDetail(view, 2); // Collar Vega: sold out
    await openDrawer();

    expect(screen.getByText(/Quedan pocas — tu pedido puede reabastecerse/)).toBeTruthy();
    expect(screen.getByText(/Se puede hacer sobre pedido/)).toBeTruthy();

    const send = screen.getByRole("link", { name: "Enviar solicitud por WhatsApp" }) as HTMLAnchorElement;
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("• 1× Collar Vega — sobre pedido");
    expect(text).toContain("• 1× Aretes Luna\n");
    expect(text).not.toContain("OLI-003");
    expect(text).not.toContain("OLI-002");
  });
});

describe("carrito — progreso hacia Iconic", () => {
  it("#305 el titular es el habitual (Girly por piezas), sin tarjetas de meta", async () => {
    localStorage.setItem(cartKey, JSON.stringify({
      v: 1,
      lines: [{
        productSlug: "anillo-blossom",
        name: "Anillo Blossom",
        sku: "AAN1385",
        qty: 4,
      }],
    }));
    await renderStore();
    await openDrawer();

    // Sin tarjetas de progreso: el resumen son filas compactas (#315/#305).
    expect(screen.queryByText(/Meta final/i)).toBeNull();
    expect(screen.queryByText(/desbloqueado/i)).toBeNull();
    // 4 piezas < 5 → habitual Regular; fila Iconic visible (< $1,000).
    expect(screen.getByText("Subtotal estimado")).toBeTruthy();
    expect(screen.getByText("$560.00 MXN")).toBeTruthy(); // 4 × 140 Regular
    expect(screen.getByText(/¿Eres Iconic\? Subtotal estimado/)).toBeTruthy();
    expect(screen.getByText("$360.00 MXN")).toBeTruthy(); // 4 × 90 Iconic

    const row = within(screen.getByRole("list")).getByText("Anillo Blossom").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Sumar una pieza de Anillo Blossom" }));
    // 5 piezas → Girly habitual (demostrable por cantidad), nunca Iconic.
    expect(await screen.findByText("$600.00 MXN")).toBeTruthy(); // 5 × 120
    expect(screen.getByText(/¿Eres Iconic\? Subtotal estimado/)).toBeTruthy();
    expect(screen.getByText("$450.00 MXN")).toBeTruthy(); // 5 × 90
  });

  it("#305 muestra el habitual y la fila Iconic condicional; cruce del umbral", async () => {
    localStorage.setItem(
      cartKey,
      JSON.stringify({
        v: 1,
        lines: [
          {
            productSlug: "anillo-blossom",
            name: "Anillo Blossom",
            sku: "AAN1385",
            qty: 10,
            unitPrices: { t_retail: 140, t_girly: 120, t_iconic: 90 },
          },
        ],
      })
    );
    await renderStore();
    await openDrawer();

    // 10 piezas → Girly $1,200 habitual (≥ $1,000): SOLO la fila habitual.
    expect(screen.getByText("$1,200.00 MXN")).toBeTruthy();
    expect(screen.queryByText(/¿Eres Iconic\?/)).toBeNull();
    expect(screen.queryByText(/Meta final/i)).toBeNull();

    // Bajar a 8 piezas → Girly $960 (< $1,000): la fila Iconic reaparece.
    const row = within(screen.getByRole("list")).getByText("Anillo Blossom").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Restar una pieza de Anillo Blossom" }));
    fireEvent.click(within(row).getByRole("button", { name: "Restar una pieza de Anillo Blossom" }));
    expect(await screen.findByText("$960.00 MXN")).toBeTruthy();
    expect(screen.getByText(/¿Eres Iconic\? Subtotal estimado/)).toBeTruthy();
    expect(screen.getByText("$720.00 MXN")).toBeTruthy(); // 8 × 90
  });

  it("#305 a 12 piezas el titular sigue siendo Girly (nunca Iconic por identidad)", async () => {
    localStorage.setItem(cartKey, JSON.stringify({
      v: 1,
      lines: [{
        productSlug: "anillo-blossom",
        name: "Anillo Blossom",
        sku: "AAN1385",
        qty: 12,
        unitPrices: { t_retail: 140, t_girly: 120, t_iconic: 90 },
      }],
    }));
    await renderStore();
    await openDrawer();

    // Habitual Girly $1,440 (≥ $1,000) → sin fila Iconic, sin "desbloqueado".
    expect(screen.getByText("$1,440.00 MXN")).toBeTruthy();
    expect(screen.queryByText(/¿Eres Iconic\?/)).toBeNull();
    expect(screen.queryByText(/desbloqueado/i)).toBeNull();
  });

  it("1.13.1 líneas y titular cuadran: 19 piezas $140/$105/$55, jamás $55/$1,045", async () => {
    // Catálogo con los números de las capturas: Girly $105 (desde 5) e Iconic
    // $55 (identidad, ≥ $1,000 a precio propio). El carrito se hidrata de aquí.
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: {
        ...catalog,
        products: catalog.products.map((p) =>
          p.productSlug === "anillo-blossom"
            ? { ...p, prices: { t_retail: 140, t_girly: 105, t_iconic: 55 } }
            : p
        ),
      },
    });
    localStorage.setItem(cartKey, JSON.stringify({
      v: 1,
      lines: [{ productSlug: "anillo-blossom", name: "Anillo Blossom", sku: "AAN1385", qty: 19 }],
    }));
    await renderStore();
    await openDrawer();

    // Titular habitual: Girly 19 × $105 = $1,995.00 (≥ $1,000 → sin fila Iconic).
    expect(screen.getByText("$1,995.00 MXN")).toBeTruthy();
    expect(screen.queryByText(/¿Eres Iconic\?/)).toBeNull();
    // La línea usa el MISMO nivel del titular: $105.00 por pieza, $1,995.00 de
    // subtotal — nunca el precio Iconic ($55/$1,045) que el total no aplica.
    const list = screen.getByRole("list");
    expect(within(list).getByText("$105.00")).toBeTruthy();
    expect(within(list).getByText("$1,995.00")).toBeTruthy();
    expect(within(list).queryByText("$55.00")).toBeNull();
    expect(within(list).queryByText("$1,045.00")).toBeNull();

    const send = screen.getByRole("link", { name: "Enviar solicitud por WhatsApp" }) as HTMLAnchorElement;
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("Subtotal estimado: $1,995.00 MXN");
    expect(text).not.toContain("1,045");
    expect(text).not.toContain("Iconic");
  });
});

describe("detalle de producto — precios por tier", () => {
  it("destaca Iconic y explica los tres niveles", async () => {
    render(<OliviaStorefront route={productRoute} />);
    expect(await screen.findByText("Anillo Blossom")).toBeTruthy();
    const prices = screen.getByRole("region", { name: "Precios por pieza" });
    expect(screen.getByText("Precio por pieza")).toBeTruthy();
    // 1.13.1: sin «?», sin ayuda flotante, sin title duplicado — la condición
    // es texto visible en la tercera columna de cada fila.
    expect(prices.querySelectorAll(".price-help-wrap")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Cómo se obtiene/ })).toBeNull();
    expect(within(prices).queryByTitle(/Obtén el mejor precio/)).toBeNull();
    expect(within(prices).getByText("Desde 5 piezas")).toBeTruthy();
    expect(within(prices).getByText("Con beneficio vigente")).toBeTruthy();
    // Cada fila: nivel + importe + condición; Regular sin requisito deja la
    // tercera celda vacía.
    const rows = Array.from(prices.querySelectorAll(".olv-price-row"));
    expect(rows.map((row) => row.querySelector("dt")?.textContent?.trim())).toEqual(["Regular", "Girly", "Iconic"]);
    expect(rows[0].querySelector(".olv-price-row-amount")).toHaveTextContent("$140");
    expect(rows[0].querySelector(".olv-price-row-condition")).toHaveTextContent("");
    expect(rows[1].querySelector(".olv-price-row-amount")).toHaveTextContent("$120");
    expect(rows[1].querySelector(".olv-price-row-condition")).toHaveTextContent("Desde 5 piezas");
    expect(rows[2].querySelector(".olv-price-row-amount")).toHaveTextContent("$90");
    expect(rows[2].querySelector(".olv-price-row-condition")).toHaveTextContent("Con beneficio vigente");
    expect(prices.querySelector(".olv-price-row--featured")).toHaveTextContent("Iconic");
    // El ahorro de Iconic no promete desbloqueo por agregar piezas.
    expect(within(prices).getByText("Hasta $50 menos por pieza con beneficio vigente")).toBeTruthy();
    // Agregar al carrito desde el detalle.
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(screen.getByRole("button", { name: "Abrir pedido" }).textContent).toContain("1");
    expect(screen.getByRole("group", { name: "Cantidad de Anillo Blossom" })).toHaveTextContent("1");
  });

  it("cae al precio único cuando la proyección está estancada (sin tiers)", async () => {
    mocks.loadPublicProduct.mockResolvedValue({
      product: { ...detail, prices: undefined },
      store: { ...store, priceTiers: null, defaultTierId: null },
    });
    render(<OliviaStorefront route={productRoute} />);
    expect(await screen.findByText("$140")).toBeTruthy();
    expect(screen.queryByText("desde 5 piezas")).toBeNull();
  });

  it("hidrata y conserva un carrito antiguo de varias líneas al entrar por detalle", async () => {
    localStorage.setItem(cartKey, JSON.stringify({
      v: 1,
      lines: [
        { productSlug: "anillo-blossom", name: "Anillo Blossom", sku: "AAN1385", qty: 4 },
        { productSlug: "aretes-luna", name: "Aretes Luna", sku: "OLI-002", qty: 1 },
      ],
    }));

    render(<OliviaStorefront route={productRoute} />);
    expect(await screen.findByText("Anillo Blossom")).toBeTruthy();
    await openDrawer();

    const list = screen.getByRole("list");
    expect(within(list).getByText("Anillo Blossom")).toBeTruthy();
    expect(within(list).getByText("Aretes Luna")).toBeTruthy();
    // #305: 5 piezas hidratadas → habitual Girly $580; fila Iconic visible (< $1,000).
    expect(screen.getByText("$580.00 MXN")).toBeTruthy();
    expect(screen.getByText(/¿Eres Iconic\? Subtotal estimado/)).toBeTruthy();
    expect(screen.getByText("$440.00 MXN")).toBeTruthy(); // 4×90 + 1×80
  });
});

describe("editorial catalog", () => {
  it.each(["", undefined])("respects an explicitly empty hero body (%s) while retaining SEO fallback", async (body) => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, storefront: { hero: { body } } },
      catalog,
    });
    await renderStore();
    const intro = document.querySelector(".olv-intro");
    if (body === "") expect(intro).toBeNull();
    else expect(intro).toHaveTextContent(OLIVIA_CONTENT.hero!.body!);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", OLIVIA_CONTENT.hero!.body);
  });

  it("conserva el logo en portada y reemplaza solo el título de marca duplicado", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, storefront: { hero: { heading: "Olivia", body: "Una selección para ti." } } },
      catalog,
    });
    const view = render(<OliviaStorefront route={storeRoute} />);
    await screen.findAllByRole("article");

    expect(screen.getByRole("heading", { name: "Tu nueva pieza favorita está aquí" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Olivia" })).toBeNull();
    expect(screen.getByRole("img", { name: "Logo de Olivia" }).closest(".olv-header-inner")).toHaveClass("olv-header-inner--home");

    view.rerender(<OliviaStorefront route={categoryRoute} />);
    expect(screen.getByRole("img", { name: "Logo de Olivia" }).closest(".olv-header-inner")).not.toHaveClass("olv-header-inner--home");
  });

  it("conserva el título personalizado del editor", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, storefront: { hero: { heading: "Nueva colección", body: "Una selección para ti." } } },
      catalog,
    });
    await renderStore();
    expect(screen.getByRole("heading", { name: "Nueva colección" })).toBeTruthy();
  });

  it("1.13.1 el pie muestra el logo (respaldo transparente; logoUrl configurado gana) y conserva sus enlaces", async () => {
    const view = await renderStore();
    const footer = document.querySelector(".olv-footer") as HTMLElement;
    const fallback = within(footer).getByRole("img", { name: "Olivia" }) as HTMLImageElement;
    expect(fallback).toHaveAttribute("src", "/images/olivia-logo.png");
    expect(fallback).toHaveClass("olv-footer-logo");
    // Enlaces vigentes del pie: WhatsApp, Explora y Entregas y atención.
    expect(within(footer).getByRole("link", { name: /Hablemos por WhatsApp/ })).toBeTruthy();
    expect(within(footer).getByRole("heading", { name: "Explora" })).toBeTruthy();
    expect(within(footer).getByRole("heading", { name: "Entregas y atención" })).toBeTruthy();

    view.unmount();
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, storefront: { logoUrl: "https://storage.example/logo.png" } },
      catalog,
    });
    render(<OliviaStorefront route={storeRoute} />);
    await screen.findAllByRole("article");
    const configured = within(document.querySelector(".olv-footer") as HTMLElement).getByRole("img", { name: "Olivia" }) as HTMLImageElement;
    expect(configured).toHaveAttribute("src", "https://storage.example/logo.png");
  });

  it("searches names/keys, sorts, and never duplicates featured/new products", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: catalog.products.map((p) => ({ ...p, price: undefined, isFeatured: true, isNew: true })) } });
    await renderStore();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "aan1385" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveAccessibleName("Anillo Blossom");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no existe" } });
    expect(screen.getByText("No encontramos piezas con estos filtros")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "price-asc" } });
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Aretes Luna");
    // Progressive load: one store read + one catalog read (the mock backs both).
    expect(mocks.loadPublicCatalog).toHaveBeenCalledTimes(2);
  });

  it("changes card photos by arrows/swipe without navigating or adding, then reuses the loaded catalog for detail", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [{ ...catalog.products[0], images: [{ url: "/one.jpg" }, { url: "/two.jpg" }] }] } });
    const view = render(<OliviaStorefront route={storeRoute} />);
    const next = await screen.findByRole("button", { name: "Foto siguiente de Anillo Blossom" });
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/one.jpg");
    fireEvent.click(next);
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/two.jpg");
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveClass("olv-photo-image");
    const photo = screen.getByRole("img", { name: "Anillo Blossom" }).closest(".olv-photo")!;
    fireEvent.touchStart(photo, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(photo, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/one.jpg");
    expect(screen.queryByRole("button", { name: "Abrir pedido" })).toBeNull();
    expect(mocks.loadPublicProduct).not.toHaveBeenCalled();
    view.rerender(<OliviaStorefront route={productRoute} />);
    await screen.findByRole("heading", { name: "Anillo Blossom" });
    // Progressive load: one store read + one catalog read (the mock backs both).
    expect(mocks.loadPublicCatalog).toHaveBeenCalledTimes(2);
    expect(mocks.loadPublicProduct).toHaveBeenCalledWith("olivia", "anillo-blossom", store);
  });

  it("keeps legacy images and hides the home banner on category routes", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store: { ...store, storefront: { hero: { imageUrl: "/banner.jpg", mobileImageUrl: "/mobile.jpg", imageAlt: "Temporada Olivia" } } }, catalog: { ...catalog, products: [{ ...catalog.products[0], imageUrl: "/legacy.jpg", categoryIds: ["c1"] }] } });
    const view = render(<OliviaStorefront route={storeRoute} />);
    expect(await screen.findByRole("img", { name: "Temporada Olivia" })).toHaveAttribute("src", "/banner.jpg");
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/legacy.jpg");
    view.rerender(<OliviaStorefront route={{ name: "public_category", params: { slug: "olivia", categorySlug: "anillos" } }} />);
    expect(screen.queryByRole("img", { name: "Temporada Olivia" })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    // Progressive load: one store read + one catalog read (the mock backs both).
    expect(mocks.loadPublicCatalog).toHaveBeenCalledTimes(2);
  });
});
