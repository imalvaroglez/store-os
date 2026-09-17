import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { OliviaStorefront } from "./OliviaStorefront";
import type {
  PublicStore,
  PublicCatalog,
  PublicProductDetail,
} from "../../app/firebase/publicCatalog";
import type { RouteMatch } from "../../lib/router";

// The storefront loads its data from the anonymous public-catalog loaders; the
// tests mock that module (no Firebase in jsdom) with a 3-tier Olivia fixture
// carrying the owner's numbers: Regular $140 / Girly $120 (desde 5) / Iconic
// $90 (desde $1,000 a precio Iconic).
const mocks = vi.hoisted(() => ({
  loadPublicCatalog: vi.fn(),
  loadPublicProduct: vi.fn(),
}));
vi.mock("../../app/firebase/publicCatalog", () => ({
  loadPublicCatalog: mocks.loadPublicCatalog,
  loadPublicProduct: mocks.loadPublicProduct,
  PublicCatalogNotFoundError: class PublicCatalogNotFoundError extends Error {
    constructor(public slug: string) {
      super(`No hay catálogo público para "${slug}".`);
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
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "anillo-blossom", name: "Anillo Blossom", price: 140, prices: { t_retail: 140, t_girly: 120, t_iconic: 90 }, stockSignal: "disponible", sku: "AAN1385" },
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "aretes-luna", name: "Aretes Luna", price: 120, prices: { t_retail: 120, t_girly: 100, t_iconic: 80 }, stockSignal: "pocas", sku: "OLI-002" },
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

const cartKey = "store-os:cart:olivia";

async function renderStore() {
  render(<OliviaStorefront route={storeRoute} />);
  // Wait for the grid to be ready.
  await screen.findAllByRole("button", { name: "Agregar al carrito" });
}

async function openDrawer() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir pedido" }));
  await screen.findByText("Tu pedido");
}

beforeEach(() => {
  localStorage.clear();
  mocks.loadPublicCatalog.mockReset().mockResolvedValue({ store, catalog });
  mocks.loadPublicProduct.mockReset().mockResolvedValue({ product: detail, store });
});

describe("carrito del storefront — acumular y pedir", () => {
  it("agrega desde el grid, muestra el contador y arma UN mensaje con todas las líneas", async () => {
    await renderStore();
    expect(screen.getByRole("img", { name: "Logo de Olivia" })).toHaveAttribute("src", "/images/olivia-logo.png");
    expect(screen.getByText("Quedan pocas")).toBeTruthy();
    expect(screen.getByText("Agotado")).toBeTruthy();
    const adds = screen.getAllByRole("button", { name: "Agregar al carrito" });
    fireEvent.click(adds[0]);
    expect(screen.getByRole("status")).toHaveTextContent("Agregado a tu pedido");
    expect(screen.getByRole("group", { name: "Cantidad de Anillo Blossom" })).toHaveTextContent("1");
    fireEvent.click(adds[1]);

    const open = screen.getByRole("button", { name: "Abrir pedido" });
    expect(open.textContent).toContain("2");
    expect(open.textContent).toContain("Ver pedido");

    await openDrawer();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Anillo Blossom")).toBeTruthy();
    expect(within(list).getByText("Aretes Luna")).toBeTruthy();

    const send = screen.getByRole("link", { name: "Enviar pedido por WhatsApp" }) as HTMLAnchorElement;
    expect(send.href).toContain("wa.me/5213344836691");
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("Pedido:");
    expect(text).toContain("• 1× Anillo Blossom (AAN1385)");
    expect(text).toContain("• 1× Aretes Luna (OLI-002)");
    expect(text).toContain("/catalogo/olivia");
    expect(text).toContain("Total de piezas: 2");
    expect(text).toContain("Precio aplicable: Regular");
    expect(text).toContain("Subtotal estimado: $260 MXN");
  });

  it("stepper ± y quitar actualizan líneas y contador", async () => {
    await renderStore();
    fireEvent.click(screen.getAllByRole("button", { name: "Agregar al carrito" })[0]);
    await openDrawer();

    const list = screen.getByRole("list");
    const row = within(list).getByText("Anillo Blossom").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Sumar una pieza" }));
    expect(within(row).getByText("2")).toBeTruthy();
    expect(screen.getByText("2 piezas")).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "Quitar" }));
    expect(screen.getByText("Tu pedido está vacío")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir pedido" })).toBeNull();
  });

  it("el carrito sobrevive la recarga (localStorage por tienda)", async () => {
    const first = render(<OliviaStorefront route={storeRoute} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Agregar al carrito" }))[0]);
    first.unmount();

    render(<OliviaStorefront route={storeRoute} />);
    const open = await screen.findByRole("button", { name: "Abrir pedido" });
    expect(open.textContent).toContain("1");
    expect(JSON.parse(localStorage.getItem(cartKey)!).lines).toHaveLength(1);
  });
});

describe("carrito — leyendas de stock (señal gruesa, nunca cifras)", () => {
  it("pocas → invitación a ordenar; agotado → sobre pedido en la línea del mensaje", async () => {
    await renderStore();
    const adds = screen.getAllByRole("button", { name: "Agregar al carrito" });
    fireEvent.click(adds[1]); // Aretes Luna: pocas
    fireEvent.click(adds[2]); // Collar Vega: agotado
    await openDrawer();

    expect(screen.getByText(/Quedan pocas — tu pedido puede reabastecerse/)).toBeTruthy();
    expect(screen.getByText(/Se puede hacer sobre pedido/)).toBeTruthy();

    const send = screen.getByRole("link", { name: "Enviar pedido por WhatsApp" }) as HTMLAnchorElement;
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("• 1× Collar Vega (OLI-003) — sobre pedido");
    expect(text).toContain("• 1× Aretes Luna (OLI-002)\n");
  });
});

describe("carrito — progreso hacia Iconic", () => {
  it("mantiene Iconic como meta y Girly como escalón intermedio", async () => {
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

    expect(screen.getByText(/Tu meta: precio Iconic/i)).toBeTruthy();
    expect(screen.getByText(/Te faltan \$640 en productos a precio Iconic/i)).toBeTruthy();
    expect(screen.getByText(/Te falta 1 pieza para desbloquear Girly/i)).toBeTruthy();
    expect(screen.queryByText(/Agrega 1 pieza y ahorrarás/i)).toBeNull();
  });

  it("muestra subtotal Girly, monto exacto faltante y ahorro de la selección actual", async () => {
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

    expect(screen.getAllByText(/Precio Girly desbloqueado/i).length).toBeGreaterThan(0);
    expect(screen.getByText("$1,200 MXN")).toBeTruthy();
    expect(screen.getByText(/Te faltan \$100 en productos a precio Iconic/i)).toBeTruthy();
    expect(screen.getByText(/Con Iconic, lo que ya llevas costaría \$300 menos/i)).toBeTruthy();
    expect(screen.queryByText(/por .* más te llevas/i)).toBeNull();
  });

  it("celebra Iconic a 12 piezas y deja de mostrar una siguiente meta", async () => {
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

    expect(screen.getAllByText(/Precio Iconic desbloqueado/i).length).toBeGreaterThan(0);
    expect(screen.getByText("$1,080 MXN")).toBeTruthy();
    expect(screen.getAllByText(/Ahorras \$600 frente a Regular/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Tu meta:/i)).toBeNull();
  });
});

describe("detalle de producto — precios por tier", () => {
  it("destaca Iconic y explica los tres niveles", async () => {
    render(<OliviaStorefront route={productRoute} />);
    expect(await screen.findByText("Anillo Blossom")).toBeTruthy();
    expect(screen.getByText("$90")).toBeTruthy();
    expect(screen.getByText("Girly").closest("p")).toHaveTextContent("Girly $120");
    expect(screen.getByRole("button", { name: "Cómo se obtiene el precio Girly" })).toHaveAttribute("title", "desde 5 piezas");
    expect(screen.getByRole("button", { name: "Cómo se obtiene el precio Iconic" })).toHaveAttribute("title", "desde $1,000 en productos a precio Iconic");
    expect(screen.getByText("Regular").closest("p")).toHaveTextContent("Regular $140");
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
    expect(screen.getAllByText(/Precio Girly desbloqueado/i).length).toBeGreaterThan(0);
    expect(screen.getByText("$580 MXN")).toBeTruthy();
    expect(screen.getByText(/Te faltan \$560 en productos a precio Iconic/i)).toBeTruthy();
  });
});

describe("editorial catalog", () => {
  it("searches names/keys, sorts, and never duplicates featured/new products", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: catalog.products.map((p) => ({ ...p, price: undefined, isFeatured: true, isNew: true })) } });
    await renderStore();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "aan1385" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("article")).toHaveAccessibleName("Anillo Blossom");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no existe" } });
    expect(screen.getByText("No encontramos esa pieza")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "price-asc" } });
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Aretes Luna");
    expect(mocks.loadPublicCatalog).toHaveBeenCalledTimes(1);
  });

  it("changes card photos by arrows/swipe without navigating or adding, then reuses the loaded catalog for detail", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { ...catalog, products: [{ ...catalog.products[0], images: [{ url: "/one.jpg" }, { url: "/two.jpg" }] }] } });
    const view = render(<OliviaStorefront route={storeRoute} />);
    const next = await screen.findByRole("button", { name: "Foto siguiente de Anillo Blossom" });
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/one.jpg");
    fireEvent.click(next);
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/two.jpg");
    const photo = screen.getByRole("img", { name: "Anillo Blossom" }).closest(".olv-photo")!;
    fireEvent.touchStart(photo, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(photo, { changedTouches: [{ clientX: 100, clientY: 105 }] });
    expect(screen.getByRole("img", { name: "Anillo Blossom" })).toHaveAttribute("src", "/one.jpg");
    expect(screen.queryByRole("button", { name: "Abrir pedido" })).toBeNull();
    expect(mocks.loadPublicProduct).not.toHaveBeenCalled();
    view.rerender(<OliviaStorefront route={productRoute} />);
    await screen.findByRole("heading", { name: "Anillo Blossom" });
    expect(mocks.loadPublicCatalog).toHaveBeenCalledTimes(1);
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
    expect(mocks.loadPublicCatalog).toHaveBeenCalledTimes(1);
  });
});
