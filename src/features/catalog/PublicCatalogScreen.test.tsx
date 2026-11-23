// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublicCatalogScreen } from "./PublicCatalogScreen";
import type { PublicCatalog, PublicStore } from "../../app/firebase/publicCatalog";

const mocks = vi.hoisted(() => ({ loadPublicCatalog: vi.fn() }));
vi.mock("../../app/firebase/publicCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/firebase/publicCatalog")>();
  return {
  ...actual,
  loadPublicCatalog: mocks.loadPublicCatalog,
  };
});

const store: PublicStore = {
  storeId: "store_santi",
  slug: "santi",
  name: "Santi",
  type: "on_demand",
  whatsappPhone: "5215512345678",
};

const catalog: PublicCatalog = {
  categories: [],
  products: [
    { storeId: "store_santi", storeSlug: "santi", productSlug: "perfume", name: "Perfume", sku: "SAN-001", price: 1500 },
    { storeId: "store_santi", storeSlug: "santi", productSlug: "tenis", name: "Tenis", sku: "SAN-002", price: 3200 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  mocks.loadPublicCatalog.mockReset().mockResolvedValue({ store, catalog });
});

describe("#371 pausa manual y agotados ocultos en el catálogo genérico", () => {
  const line = (productSlug: string, name: string, extra: Record<string, unknown> = {}) => ({
    storeId: "store_santi", storeSlug: "santi", productSlug, name, sku: "SAN-X", price: 1000, ...extra,
  });

  it("pausa manual (availability sold_out CON existencia) muestra Agotado y no ofrece agregar", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: {
        categories: [],
        products: [
          line("perfume", "Perfume", { availability: "sold_out", stockSignal: "disponible" }), // pausa deliberada
          line("tenis", "Tenis", { stockSignal: "disponible" }),
        ],
      },
    });
    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("Perfume")).toBeTruthy();
    expect(screen.getByText("Agotado")).toBeTruthy();
    // Solo el disponible ofrece control de carrito.
    const adds = screen.getAllByRole("button", { name: "Agregar al carrito" });
    expect(adds).toHaveLength(1);
    expect(adds[0].closest("h2")?.textContent ?? "").toBe(""); // (guard) el botón pertenece a Tenis vía tarjeta
  });

  it("agotado por existencia se trata igual (insignia + sin control)", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: { categories: [], products: [line("perfume", "Perfume", { stockSignal: "agotado" })] },
    });
    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("Agotado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agregar al carrito" })).toBeNull();
  });

  it("showSoldOut en false OCULTA los agotados (y el carrito guardado se poda)", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, storefront: { showSoldOut: false } },
      catalog: {
        categories: [],
        products: [line("perfume", "Perfume", { availability: "sold_out" }), line("tenis", "Tenis", {})],
      },
    });
    // Carrito guardado con la pieza pausada: debe desaparecer del pedido.
    localStorage.setItem("store-os:cart:santi", JSON.stringify({ v: 1, lines: [{ productSlug: "perfume", name: "Perfume", qty: 2 }] }));
    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("Tenis")).toBeTruthy();
    expect(screen.queryByText("Perfume")).toBeNull();
    // El botón flotante no aparece: no quedan piezas en el carrito.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Abrir pedido/ })).toBeNull());
  });

  it("una pieza pausada que ya estaba en el carrito pasa a sobre pedido (no se solicita)", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: { categories: [], products: [line("perfume", "Perfume", { availability: "sold_out", stockSignal: "disponible" })] },
    });
    localStorage.setItem("store-os:cart:santi", JSON.stringify({ v: 1, lines: [{ productSlug: "perfume", name: "Perfume", qty: 1 }] }));
    render(<PublicCatalogScreen slug="santi" />);
    fireEvent.click(await screen.findByRole("button", { name: /Abrir pedido/ }));
    expect(await screen.findByText(/Se puede hacer sobre pedido/)).toBeTruthy();
  });
});

describe("#135 encargo sobre agotados y filtro por acabado", () => {
  const line = (productSlug: string, name: string, extra: Record<string, unknown> = {}) => ({
    storeId: "store_santi", storeSlug: "santi", productSlug, name, sku: "SAN-X", price: 1000, ...extra,
  });

  it("una pieza agotada ofrece «Pedir por encargo» con fecha por confirmar (sin control de compra)", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: { categories: [], products: [line("perfume", "Perfume", { stockSignal: "agotado" })] },
    });
    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("Agotado")).toBeTruthy();
    expect(screen.getByText(/Fecha de entrega por confirmar/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pedir por encargo/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agregar al carrito" })).toBeNull();
  });

  it("el encargo entra al carrito como «sobre pedido» — el cajón lo explica", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: { categories: [], products: [line("perfume", "Perfume", { availability: "sold_out", stockSignal: "disponible" })] }, // pausa manual
    });
    render(<PublicCatalogScreen slug="santi" />);
    fireEvent.click(await screen.findByRole("button", { name: /Pedir por encargo/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Abrir pedido/ }));
    expect(await screen.findByText(/Se puede hacer sobre pedido/)).toBeTruthy();
  });

  it("filtro por acabado dorado/plateado cuando las piezas lo declaran", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: {
        categories: [],
        products: [
          line("aro-dorado", "Aro Dorado", { finish: "Dorado" }),
          line("aro-plateado", "Aro Plateado", { finish: "Plateado" }),
          line("collar-sin", "Collar sin acabado"),
        ],
      },
    });
    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("Aro Dorado")).toBeTruthy();
    const dorado = screen.getByRole("button", { name: "Dorado" });
    fireEvent.click(dorado);
    await waitFor(() => {
      expect(screen.queryByText("Aro Plateado")).toBeNull();
      expect(screen.queryByText("Collar sin acabado")).toBeNull();
      expect(screen.getByText("Aro Dorado")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Plateado" }));
    await waitFor(() => {
      expect(screen.queryByText("Aro Dorado")).toBeNull();
      expect(screen.getByText("Aro Plateado")).toBeTruthy();
    });
  });

  it("sin acabados declarados no aparecen chips de acabado", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store,
      catalog: { categories: [], products: [line("collar", "Collar")] },
    });
    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("Collar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dorado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plateado" })).toBeNull();
  });
});

describe("#137 selector público de variantes en la tarjeta", () => {
  const variantLine = (productSlug: string, name: string, extra: Record<string, unknown> = {}) => ({
    storeId: "store_santi", storeSlug: "santi", productSlug, name, sku: "SAN-X", price: 1000,
    imageUrl: null, ...extra,
  });
  const design = {
    ...variantLine("aro-luna", "Aro Luna", { stockSignal: "disponible" }),
    variants: [
      { id: "v1", color: "Dorado", imageUrl: "https://img/dorado.jpg", stockSignal: "disponible" },
      { id: "v2", color: "Plateado", imageUrl: "https://img/plateado.jpg", stockSignal: "agotado" },
    ],
  };

  it("muestra muestras accesibles con estado seleccionado y cambia foto y disponibilidad", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { categories: [], products: [design] } });
    render(<PublicCatalogScreen slug="santi" />);
    const dorado = await screen.findByRole("button", { name: /Dorado/ });
    expect(dorado.getAttribute("aria-pressed")).toBe("true");
    const plateado = screen.getByRole("button", { name: /Plateado/ });
    expect(plateado.getAttribute("aria-pressed")).toBe("false");
    // Foto inicial: la del Dorado (primera variante).
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://img/dorado.jpg");
    fireEvent.click(plateado);
    await waitFor(() => {
      expect(document.querySelector("img")?.getAttribute("src")).toBe("https://img/plateado.jpg");
      expect(screen.getAllByText(/Agotado/i).length).toBeGreaterThan(0);
      expect(plateado.getAttribute("aria-pressed")).toBe("true");
      expect(dorado.getAttribute("aria-pressed")).toBe("false");
    });
  });

  it("el color agotado ofrece encargo (sobre pedido) y el disponible compra normal", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { categories: [], products: [design] } });
    render(<PublicCatalogScreen slug="santi" />);
    expect((await screen.findByRole("button", { name: "Agregar al carrito" }))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Plateado/ }));
    expect(await screen.findByRole("button", { name: /Pedir por encargo/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agregar al carrito" })).toBeNull();
  });

  it("la bolsa conserva el color elegido: dos colores del mismo diseño son dos líneas", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { categories: [], products: [design] } });
    render(<PublicCatalogScreen slug="santi" />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar al carrito" })); // Dorado
    fireEvent.click(screen.getByRole("button", { name: /Plateado/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pedir por encargo/i })); // Plateado agotado
    fireEvent.click(screen.getByRole("button", { name: /Abrir pedido/ }));
    expect(await screen.findByText(/Aro Luna · Dorado/)).toBeTruthy();
    expect(screen.getByText(/Aro Luna · Plateado/)).toBeTruthy();
    expect(screen.getByText(/Se puede hacer sobre pedido/)).toBeTruthy(); // solo la línea del color agotado
  });

  it("prune conserva las líneas por color cuando el diseño sigue visible", async () => {
    // Carrito guardado con las dos líneas (slug~variantId); el catálogo sigue
    // mostrando el diseño: nada se pierde.
    localStorage.setItem("store-os:cart:santi", JSON.stringify({ v: 1, lines: [
      { productSlug: "aro-luna~v1", name: "Aro Luna · Dorado", sku: "SAN-X", qty: 1 },
      { productSlug: "aro-luna~v2", name: "Aro Luna · Plateado", sku: "SAN-X", qty: 2 },
    ] }));
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: { categories: [], products: [design] } });
    render(<PublicCatalogScreen slug="santi" />);
    const open = await screen.findByRole("button", { name: /Abrir pedido/ });
    expect(open.textContent).toContain("3 piezas");
  });
});

describe("PublicCatalogScreen carrito", () => {
  it("agrega productos, muestra cantidades en las tarjetas y arma el pedido", async () => {
    render(<PublicCatalogScreen slug="santi" />);
    const adds = await screen.findAllByRole("button", { name: "Agregar al carrito" });

    fireEvent.click(adds[0]);
    const perfume = screen.getByRole("group", { name: "Cantidad de Perfume" });
    expect(within(perfume).getByText("1")).toBeTruthy();
    fireEvent.click(within(perfume).getByRole("button", { name: "Sumar una pieza de Perfume" }));
    expect(within(screen.getByRole("group", { name: "Cantidad de Perfume" })).getByText("2")).toBeTruthy();
    fireEvent.click(adds[1]);

    const open = screen.getByRole("button", { name: "Abrir pedido" });
    expect(open.textContent).toContain("3 piezas");
    fireEvent.click(open);

    const list = screen.getByRole("list");
    expect(within(list).getByText("Perfume")).toBeTruthy();
    expect(within(list).getByText("Tenis")).toBeTruthy();
    expect(within(list).queryByText("Cantidad")).toBeNull();
    expect(within(list).getAllByText("Precio por pieza")).toHaveLength(2);
    expect(within(list).getAllByText("Subtotal")).toHaveLength(2);
    expect(within(list).getByText("$1,500.00")).toBeTruthy();
    expect(within(list).getByText("$3,000.00")).toBeTruthy();
    const send = screen.getByRole("link", { name: "Enviar solicitud por WhatsApp" }) as HTMLAnchorElement;
    expect(send.href).toContain("wa.me/5215512345678");
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("• 2× Perfume");
    expect(text).toContain("• 1× Tenis");
    expect(text).not.toContain("SAN-001");
    expect(text).not.toContain("SAN-002");
  });

  it("limpia piezas que ya no están publicadas", async () => {
    localStorage.setItem("store-os:cart:santi", JSON.stringify({
      v: 1,
      lines: [{ productSlug: "retirado", name: "Retirado", sku: "OLD", qty: 1 }],
    }));
    render(<PublicCatalogScreen slug="santi" />);
    await screen.findAllByRole("button", { name: "Agregar al carrito" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Abrir pedido" })).toBeNull());
    expect(JSON.parse(localStorage.getItem("store-os:cart:santi")!).lines).toEqual([]);
  });

  it("muestra precio por confirmar cuando una pieza legacy no tiene precio público", async () => {
    const legacyCatalog: PublicCatalog = {
      categories: [],
      products: [{ storeId: "store_santi", storeSlug: "santi", productSlug: "sin-precio", name: "Sin precio", sku: "SAN-004" }],
    };
    mocks.loadPublicCatalog.mockResolvedValue({ store, catalog: legacyCatalog });

    render(<PublicCatalogScreen slug="santi" />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar al carrito" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir pedido" }));

    expect(within(screen.getByRole("list")).getAllByText("Por confirmar")).toHaveLength(2);
    expect(within(screen.getByRole("list")).queryByText(/SAN-004/)).toBeNull();
  });

  it("usa los niveles configurados y envía el subtotal aplicable", async () => {
    const tieredStore: PublicStore = {
      ...store,
      type: "inventory_tiered",
      priceTiers: [
        { id: "t_retail", label: "Regular", order: 0 },
        { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
        { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
      ],
      defaultTierId: "t_retail",
    };
    const tieredCatalog: PublicCatalog = {
      categories: [],
      products: [{
        storeId: "store_santi",
        storeSlug: "santi",
        productSlug: "anillo",
        name: "Anillo",
        sku: "SAN-003",
        price: 140,
        prices: { t_retail: 140, t_girly: 120, t_iconic: 90 },
      }],
    };
    localStorage.setItem("store-os:cart:santi", JSON.stringify({
      v: 1,
      lines: [{
        productSlug: "anillo",
        name: "Anillo",
        sku: "SAN-003",
        qty: 12,
        unitPrices: { t_retail: 140, t_girly: 120, t_iconic: 90 },
      }],
    }));
    mocks.loadPublicCatalog.mockResolvedValue({ store: tieredStore, catalog: tieredCatalog });

    render(<PublicCatalogScreen slug="santi" />);
    expect(await screen.findByText("$90")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cómo se obtiene el precio Iconic" })).toHaveAttribute("title", "Obtén el mejor precio al comprar desde $1,000 en productos a precio Iconic");
    fireEvent.click(screen.getByRole("button", { name: "Abrir pedido" }));
    expect(await screen.findByText("$1,080.00 MXN")).toBeTruthy();
    expect(screen.getByText("Subtotal estimado - precio Iconic")).toBeTruthy();
    expect(screen.queryByText("Subtotal estimado - precio Girly")).toBeNull();
    expect(within(screen.getByRole("list")).getByText("Precio por pieza")).toBeTruthy();

    const send = screen.getByRole("link", { name: "Enviar solicitud por WhatsApp" }) as HTMLAnchorElement;
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("*12 piezas en total*");
    expect(text).toContain("Subtotal estimado - precio Iconic: $1,080.00 MXN");
    expect(text).not.toContain("Girly");
  });

  it("sin tarifa Iconic visible no hay segunda fila ni línea en WhatsApp (#420)", async () => {
    const girlyOnly: PublicStore = {
      ...store,
      type: "inventory_tiered",
      priceTiers: [
        { id: "t_retail", label: "Regular", order: 0 },
        { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
      ],
      defaultTierId: "t_retail",
    };
    mocks.loadPublicCatalog.mockResolvedValue({
      store: girlyOnly,
      catalog: {
        categories: [],
        products: [{
          storeId: "store_santi", storeSlug: "santi", productSlug: "anillo", name: "Anillo", sku: "SAN-003",
          price: 150, prices: { t_retail: 150, t_girly: 100 },
        }],
      },
    });
    localStorage.setItem("store-os:cart:santi", JSON.stringify({
      v: 1,
      lines: [{
        productSlug: "anillo", name: "Anillo", sku: "SAN-003", qty: 6,
        unitPrices: { t_retail: 150, t_girly: 100 },
      }],
    }));

    render(<PublicCatalogScreen slug="santi" />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir pedido" }));
    expect(await screen.findByText("Subtotal estimado - precio Girly")).toBeTruthy();
    expect(screen.getByText("$600.00 MXN")).toBeTruthy();
    expect(screen.queryByText(/¿Eres/)).toBeNull();
    expect(screen.queryByText(/Te faltan/)).toBeNull();

    const send = screen.getByRole("link", { name: "Enviar solicitud por WhatsApp" }) as HTMLAnchorElement;
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("Subtotal estimado - precio Girly: $600.00 MXN");
    expect(text).not.toContain("Iconic");
    expect(text).not.toContain("¿Eres");
  });
});

describe("missing real vs fallo de red (#276)", () => {
  it("un slug inexistente (PublicCatalogNotFoundError) sigue mostrando 'Tienda no encontrada'", async () => {
    const { PublicCatalogNotFoundError } = await import("../../app/firebase/publicCatalog");
    mocks.loadPublicCatalog.mockRejectedValue(new PublicCatalogNotFoundError("no-existe"));
    render(<PublicCatalogScreen slug="no-existe" />);
    expect(await screen.findByText("Tienda no encontrada")).toBeTruthy();
    expect(screen.queryByText(/No se pudo cargar/)).toBeNull();
  });

  it("un rechazo de loadPublicCatalog muestra reintentar, no 'no existe'", async () => {
    mocks.loadPublicCatalog.mockRejectedValue(new Error("Firestore REST 500"));
    render(<PublicCatalogScreen slug="olivia" />);
    expect(await screen.findByText("No se pudo cargar el catálogo")).toBeTruthy();
    expect(screen.queryByText(/no existe o no está disponible/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("#286 catálogo aún no publicado (tienda ok): mensaje honesto, sin 'revisa tu conexión' ni reintento", async () => {
    const { PublicCatalogUnpublishedError } = await import("../../app/firebase/publicCatalog");
    mocks.loadPublicCatalog.mockRejectedValue(new PublicCatalogUnpublishedError("olivia"));
    render(<PublicCatalogScreen slug="olivia" />);
    expect(await screen.findByText("Catálogo no disponible por ahora")).toBeTruthy();
    expect(screen.getByText(/todavía no publica sus piezas/)).toBeTruthy();
    expect(screen.queryByText(/Revisa tu conexión/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.queryByText(/no existe o no está disponible/)).toBeNull();
  });
});

describe("#489 stock determines inventory availability", () => {
  it("keeps a stocked legacy sold_out product visible and selectable with sold-out products hidden", async () => {
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, type: "inventory_tiered", storefront: { showSoldOut: false } },
      catalog: { categories: [], products: [
        { ...catalog.products[0], name: "Pieza con stock", availability: "sold_out", stockSignal: "disponible" },
        { ...catalog.products[1], name: "Pieza sin stock", availability: "available", stockSignal: "agotado" },
      ] },
    });
    render(<PublicCatalogScreen slug="santi" />);
    await screen.findByText("Pieza con stock");
    expect(screen.queryByText("Pieza sin stock")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(screen.getByRole("group", { name: "Cantidad de Pieza con stock" })).toHaveTextContent("1");
  });
});


it("#489 a legacy manual mark cannot block an available color or offer an empty one", async () => {
  mocks.loadPublicCatalog.mockResolvedValue({
    store: { ...store, type: "inventory_tiered" },
    catalog: { categories: [], products: [{ ...catalog.products[0], availability: "sold_out", stockSignal: "disponible", variants: [
      { id: "silver", color: "Plateado", imageUrl: null, stockSignal: "disponible" },
      { id: "gold", color: "Dorado", imageUrl: null, stockSignal: "agotado" },
    ] }] },
  });
  render(<PublicCatalogScreen slug="santi" />);
  await screen.findByText("Perfume");
  expect(screen.getByRole("button", { name: "Agregar al carrito" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dorado" }));
  expect(screen.queryByRole("button", { name: "Agregar al carrito" })).toBeNull();
  expect(screen.getByText("Agotado")).toBeTruthy();
});


it("#489 refreshes a persisted color inquiry before composing WhatsApp", async () => {
  localStorage.setItem("store-os:cart:santi", JSON.stringify({ v: 1, lines: [{ productSlug: "perfume~silver", name: "Perfume · Plateado", sku: "OLD", qty: 2, inquire: true }] }));
  mocks.loadPublicCatalog.mockResolvedValue({ store: { ...store, type: "inventory_tiered" }, catalog: { categories: [], products: [{
    ...catalog.products[0], availability: "sold_out", stockSignal: "disponible", variants: [{ id: "silver", color: "Plateado", imageUrl: null, stockSignal: "disponible" }],
  }] } });
  render(<PublicCatalogScreen slug="santi" />);
  fireEvent.click(await screen.findByRole("button", { name: /Abrir pedido/ }));
  const link = await screen.findByRole("link", { name: "Enviar solicitud por WhatsApp" });
  await waitFor(() => expect(decodeURIComponent(link.getAttribute("href")!)).not.toContain("sobre pedido"));
  const saved = JSON.parse(localStorage.getItem("store-os:cart:santi")!);
  expect(saved.lines[0]).toMatchObject({ qty: 2, inquire: false });
});


it("#489 a session-added color line is a firm order despite a stale global sold-out signal", async () => {
  // Legacy RCA shape: the aggregate stockSignal is an old "agotado" while the
  // chosen color is available. The new line must not inherit "sobre pedido".
  mocks.loadPublicCatalog.mockResolvedValue({ store: { ...store, type: "inventory_tiered" }, catalog: { categories: [], products: [{
    ...catalog.products[0], availability: "sold_out", stockSignal: "agotado", variants: [{ id: "silver", color: "Plateado", imageUrl: null, stockSignal: "disponible" }],
  }] } });
  render(<PublicCatalogScreen slug="santi" />);
  fireEvent.click(await screen.findByRole("button", { name: "Agregar al carrito" }));
  fireEvent.click(screen.getByRole("button", { name: /Abrir pedido/ }));
  const link = await screen.findByRole("link", { name: "Enviar solicitud por WhatsApp" });
  expect(decodeURIComponent(link.getAttribute("href")!)).toContain("1× Perfume · Plateado");
  expect(decodeURIComponent(link.getAttribute("href")!)).not.toContain("sobre pedido");
  const saved = JSON.parse(localStorage.getItem("store-os:cart:santi")!);
  expect(saved.lines[0]).toMatchObject({ productSlug: "perfume~silver", qty: 1, inquire: false });
});

it("#489 keeps a sellable color visible despite an old aggregate shortage signal", async () => {
  mocks.loadPublicCatalog.mockResolvedValue({ store: { ...store, type: "inventory_tiered", storefront: { showSoldOut: false } }, catalog: { categories: [], products: [{
    ...catalog.products[0], availability: "sold_out", stockSignal: "agotado", variants: [
      { id: "silver", color: "Plateado", imageUrl: null, stockSignal: "disponible" },
      { id: "gold", color: "Dorado", imageUrl: null, stockSignal: "agotado" },
    ],
  }] } });
  render(<PublicCatalogScreen slug="santi" />);
  await screen.findByText("Perfume");
  expect(screen.getByRole("button", { name: "Agregar al carrito" })).toBeTruthy();
});

describe("#461 selección exacta color × talla en el catálogo genérico", () => {
  const sizedStore: PublicStore = { ...store, type: "inventory_tiered" };
  const sizedProduct = {
    storeId: "store_santi", storeSlug: "santi", productSlug: "anillo", name: "Anillo Sol", sku: "SAN-010",
    prices: { t_retail: 1400 },
    variants: [
      { id: "v_dorado", color: "Dorado", imageUrl: null, stockSignal: "disponible", sizes: [
        { id: "s4", size: "4", stockSignal: "disponible" },
        { id: "s6", size: "6", stockSignal: "agotado" },
      ] },
      { id: "v_plateado", color: "Plateado", imageUrl: null, stockSignal: "disponible", sizes: [
        { id: "s8", size: "8", stockSignal: "disponible" },
      ] },
      { id: "v_rosa", color: "Rosa", imageUrl: null, stockSignal: "disponible" },
    ],
  };

  function openSized() {
    mocks.loadPublicCatalog.mockResolvedValue({ store: sizedStore, catalog: { categories: [], products: [sizedProduct as never] } });
    render(<PublicCatalogScreen slug="santi" />);
  }

  it("la tarjeta ofrece las tallas del color elegido y nunca las de otro color; la línea es la combinación exacta", async () => {
    openSized();
    await screen.findByText("Anillo Sol");
    // Dorado por defecto: tallas 4 y 6 (Plateado · 8 no aparece)
    const talla4 = screen.getByRole("button", { name: "4" });
    expect(screen.queryByRole("button", { name: "8" })).toBeNull();
    fireEvent.click(talla4);
    fireEvent.click(screen.getAllByRole("button", { name: /Agregar al carrito/i })[0]);
    const saved = JSON.parse(localStorage.getItem("store-os:cart:santi")!);
    expect(saved.lines[0]).toMatchObject({ productSlug: "anillo~v_dorado~s4", name: "Anillo Sol · Dorado · 4", qty: 1 });
  });

  it("cambiar de color conserva la talla sólo si sigue siendo válida (etiqueta) y re-valida disponibilidad", async () => {
    openSized();
    await screen.findByText("Anillo Sol");
    // Dorado talla 4 → Plateado (sin talla 4, con talla 8): cae a la primera de Plateado
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "Plateado" }));
    expect(screen.getByRole("button", { name: "8", pressed: true })).toBeTruthy();
    // Rosa no tiene tallas: el selector desaparece
    fireEvent.click(screen.getByRole("button", { name: "Rosa" }));
    expect(screen.queryByRole("button", { name: "8" })).toBeNull();
  });

  it("talla agotada muestra Agotado y ofrece encargo con la combinación inequívoca", async () => {
    openSized();
    await screen.findByText("Anillo Sol");
    fireEvent.click(screen.getByRole("button", { name: "6" })); // agotada
    expect(screen.getByText("Agotado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pedir por encargo/i }));
    const saved = JSON.parse(localStorage.getItem("store-os:cart:santi")!);
    expect(saved.lines[0]).toMatchObject({ productSlug: "anillo~v_dorado~s6", name: "Anillo Sol · Dorado · 6", inquire: true });
    expect(screen.getByText(/Agotado \(Dorado · 6\)/)).toBeTruthy();
  });

  it("dos tallas del mismo color quedan en renglones separados y el mensaje lleva producto, color y talla", async () => {
    openSized();
    await screen.findByText("Anillo Sol");
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Agregar al carrito/i })[0]);
    // Volver a Dorado 6 (agotada → encargo) como segundo renglón
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    fireEvent.click(screen.getByRole("button", { name: /Pedir por encargo/i }));
    const saved = JSON.parse(localStorage.getItem("store-os:cart:santi")!);
    expect(saved.lines.map((l: { productSlug: string }) => l.productSlug)).toEqual(["anillo~v_dorado~s4", "anillo~v_dorado~s6"]);
  });

  it("una selección retirada (talla que dejó de existir) pide volver a elegir en la bolsa, sin sustituir", async () => {
    localStorage.setItem("store-os:cart:santi", JSON.stringify({ v: 1, lines: [
      { productSlug: "anillo~v_dorado~s6", name: "Anillo Sol · Dorado · 6", sku: "SAN-010", qty: 1 },
    ] }));
    // El catálogo actual ya no ofrece la talla 6 del Dorado (quedó s4 sola).
    const withoutS6 = { ...sizedProduct, variants: sizedProduct.variants.map((v: { id: string; sizes?: unknown[] }) => v.id === "v_dorado" ? { ...v, sizes: [{ id: "s4", size: "4", stockSignal: "disponible" }] } : v) };
    mocks.loadPublicCatalog.mockResolvedValue({ store: sizedStore, catalog: { categories: [], products: [withoutS6 as never] } });
    render(<PublicCatalogScreen slug="santi" />);
    await screen.findByText("Anillo Sol");
    fireEvent.click(await screen.findByRole("button", { name: /Abrir pedido/ }));
    expect(await screen.findByText(/ya no está disponible/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enviar solicitud por WhatsApp/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Quitar/i }));
    expect(await screen.findByText(/vacío/i)).toBeTruthy();
  });
});

// Regresión (implementación, 23-nov): el resumen del catálogo (`publicCatalogs`)
// es la fuente de ESTA cuadrícula — de ahí lee las tallas de cada tarjeta. Un
// cambio en la proyección que quitara las tallas del resumen pasó todas las
// pruebas porque los fixtures traían las tallas armadas a mano. Esta prueba
// parte del resumen que la app publica de verdad.
describe("#461 el resumen REAL que publica la app alimenta la talla de la cuadrícula", () => {
  it("la tarjeta ofrece las tallas a partir de projectPublicProductSummary y la línea es la combinación exacta", async () => {
    const { projectPublicProductSummary } = await import("../../app/firebase/firestoreData");
    const product = {
      id: "p_sol", storeId: "store_santi", slug: "anillo", name: "Anillo Sol", sku: "SAN-010", category: "other", isPublic: true, status: "published",
      prices: { t_retail: 1400 },
      variants: [
        {
          id: "v_dorado", color: "Dorado", skuSuffix: "D", sku: "SAN-010-D", cost: 100, createdAt: "", updatedAt: "",
          sizes: [
            { id: "s4", size: "4", sku: "SAN-010-D-4", cost: 100, quantityOnHand: 2, createdAt: "", updatedAt: "" },
            { id: "s6", size: "6", sku: "SAN-010-D-6", cost: 100, quantityOnHand: 0, createdAt: "", updatedAt: "" },
          ],
        },
        { id: "v_rosa", color: "Rosa", skuSuffix: "R", sku: "SAN-010-R", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
      ],
      createdAt: "", updatedAt: "",
    };
    const summary = projectPublicProductSummary(product as never, "santi", { defaultTierId: "t_retail" });
    // Lo que la app publica: el resumen lleva las tallas del color con su señal gruesa.
    expect((summary.variants as Array<{ sizes?: unknown[] }>)[0].sizes).toHaveLength(2);
    mocks.loadPublicCatalog.mockResolvedValue({
      store: { ...store, type: "inventory_tiered" },
      catalog: { categories: [], products: [summary as never] },
    });
    render(<PublicCatalogScreen slug="santi" />);
    await screen.findByText("Anillo Sol");
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Agregar al carrito/i })[0]);
    const saved = JSON.parse(localStorage.getItem("store-os:cart:santi")!);
    expect(saved.lines[0]).toMatchObject({ productSlug: "anillo~v_dorado~s4", name: "Anillo Sol · Dorado · 4", qty: 1 });
  });
});
