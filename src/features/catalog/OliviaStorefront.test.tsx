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
// carrying the owner's numbers: Menudeo $140 / Girly $115 (desde 5) / Iconic
// $95 (desde $1,000 a precio Iconic).
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
    { id: "t_retail", label: "Menudeo", order: 0 },
    { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
    { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
  ],
  defaultTierId: "t_retail",
};

const catalog: PublicCatalog = {
  categories: [{ id: "c1", name: "Anillos", slug: "anillos", sortOrder: 0 }],
  products: [
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "anillo-blossom", name: "Anillo Blossom", price: 140, prices: { t_retail: 140, t_girly: 115, t_iconic: 95 }, stockSignal: "disponible", sku: "AAN1385" },
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "aretes-luna", name: "Aretes Luna", price: 120, prices: { t_retail: 120 }, stockSignal: "pocas", sku: "OLI-002" },
    { storeId: "store_olivia", storeSlug: "olivia", productSlug: "collar-vega", name: "Collar Vega", price: 200, prices: { t_retail: 200 }, stockSignal: "agotado", sku: "OLI-003" },
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
  prices: { t_retail: 140, t_girly: 115, t_iconic: 95 },
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
    const adds = screen.getAllByRole("button", { name: "Agregar al carrito" });
    fireEvent.click(adds[0]);
    fireEvent.click(adds[1]);

    const open = screen.getByRole("button", { name: "Abrir pedido" });
    expect(open.textContent).toContain("2");

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
    // Sin precios ni totales en v1: el precio se cierra en el chat.
    expect(text).not.toContain("$");
  });

  it("stepper ± y quitar actualizan líneas y contador", async () => {
    await renderStore();
    fireEvent.click(screen.getAllByRole("button", { name: "Agregar al carrito" })[0]);
    await openDrawer();

    const list = screen.getByRole("list");
    const row = within(list).getByText("Anillo Blossom").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Sumar una pieza" }));
    expect(within(row).getByText("2")).toBeTruthy();
    expect(screen.getByText(/2 piezas en tu pedido/)).toBeTruthy();

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

describe("carrito — hint de ventas por tier", () => {
  it("muestra el ahorro del mejor tier que califica y la brecha al siguiente", async () => {
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
            unitPrices: { t_retail: 140, t_girly: 115, t_iconic: 95 },
          },
        ],
      })
    );
    await renderStore();
    await openDrawer();

    // 10 × (140 − 115) = $250 frente a menudeo, con precio Girly.
    expect(screen.getByText(/Con precio Girly ahorras \$250 frente a Menudeo/i)).toBeTruthy();
    // Brecha a Iconic: 1 pieza más ($95) = $140 de producto a precio menudeo.
    expect(screen.getByText(/A precio Iconic te falta 1 pieza más/)).toBeTruthy();
    expect(screen.getByText(/por \$95 más te llevas \$140 de producto/)).toBeTruthy();
  });
});

describe("detalle de producto — precios por tier", () => {
  it("muestra la tabla de tiers con sus mínimos y el default resaltado", async () => {
    render(<OliviaStorefront route={productRoute} />);
    expect(await screen.findByText("Anillo Blossom")).toBeTruthy();
    expect(screen.getByText("$115")).toBeTruthy();
    expect(screen.getByText("desde 5 piezas")).toBeTruthy();
    expect(screen.getByText("desde $1,000 a precio Iconic")).toBeTruthy();
    // Default resaltado.
    expect(screen.getByText(/Precio público/)).toBeTruthy();
    // Agregar al carrito desde el detalle.
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(screen.getByRole("button", { name: "Abrir pedido" }).textContent).toContain("1");
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
});
