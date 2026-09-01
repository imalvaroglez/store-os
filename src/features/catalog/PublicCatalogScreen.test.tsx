// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublicCatalogScreen } from "./PublicCatalogScreen";
import type { PublicCatalog, PublicStore } from "../../app/firebase/publicCatalog";

const mocks = vi.hoisted(() => ({ loadPublicCatalog: vi.fn() }));
vi.mock("../../app/firebase/publicCatalog", () => ({
  loadPublicCatalog: mocks.loadPublicCatalog,
}));

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
    const send = screen.getByRole("link", { name: "Enviar pedido por WhatsApp" }) as HTMLAnchorElement;
    expect(send.href).toContain("wa.me/5215512345678");
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("• 2× Perfume (SAN-001)");
    expect(text).toContain("• 1× Tenis (SAN-002)");
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
    expect(screen.getByText("desde $1,000 en productos a precio Iconic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir pedido" }));
    expect(await screen.findByText("$1,080 MXN")).toBeTruthy();

    const send = screen.getByRole("link", { name: "Enviar pedido por WhatsApp" }) as HTMLAnchorElement;
    const text = decodeURIComponent(send.href.split("text=")[1]);
    expect(text).toContain("Precio aplicable: Iconic");
    expect(text).toContain("Subtotal estimado: $1,080 MXN");
  });
});
