import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCart,
  saveCart,
  addToCart,
  setCartQty,
  removeCartLine,
  refreshCart,
  pruneCartLines,
  cartPieces,
  cartItemFromPublicProduct,
  publicQuantityCap,
  type CartLine,
} from "./cart";

const line = (productSlug: string, name: string, qty = 1): CartLine => ({
  productSlug,
  name,
  sku: `SKU-${productSlug}`,
  qty,
});

beforeEach(() => {
  localStorage.clear();
});

describe("cart persistence por tienda", () => {
  it("normaliza la misma línea para resumen público y detalle", () => {
    expect(cartItemFromPublicProduct({
      productSlug: "p1",
      name: "Anillo",
      prices: { t_retail: 140 },
      stockSignal: "agotado",
    })).toEqual({
      productSlug: "p1",
      name: "Anillo",
      sku: "p1",
      image: undefined,
      unitPrices: { t_retail: 140 },
      inquire: true,
    });
  });

  it("guarda y carga por slug; otra tienda no ve el carrito", () => {
    saveCart("olivia", [line("p1", "Anillo Blossom", 2)]);
    expect(loadCart("olivia")).toEqual([line("p1", "Anillo Blossom", 2)]);
    expect(loadCart("santi")).toEqual([]);
  });

  it("JSON corrupto se descarta y el carrito arranca limpio", () => {
    localStorage.setItem("store-os:cart:olivia", "{not json");
    expect(loadCart("olivia")).toEqual([]);
    // tras la corrupción, un ciclo normal de save/load funciona
    saveCart("olivia", [line("p1", "Anillo Blossom", 1)]);
    expect(loadCart("olivia")).toHaveLength(1);
  });

  it("una versión de esquema desconocida se descarta", () => {
    localStorage.setItem(
      "store-os:cart:olivia",
      JSON.stringify({ v: 999, lines: [line("p1", "X")] })
    );
    expect(loadCart("olivia")).toEqual([]);
  });
});

describe("cart mutations", () => {
  it("cierra el inventario si falta el límite en una proyección vieja", () => {
    expect(publicQuantityCap("inventory_tiered", undefined)).toBe(0);
    expect(publicQuantityCap("inventory_tiered", 3.8)).toBe(3);
    expect(publicQuantityCap("on_demand", undefined)).toBeUndefined();
  });

  it("addToCart acumula cantidad en la línea existente y conserva el orden", () => {
    let lines = addToCart("olivia", { productSlug: "p1", name: "Anillo Blossom", sku: "SKU-p1" });
    lines = addToCart("olivia", { productSlug: "p2", name: "Aretes Luna", sku: "SKU-p2" });
    lines = addToCart("olivia", { productSlug: "p1", name: "Anillo Blossom", sku: "SKU-p1" });
    expect(lines.map((l) => [l.productSlug, l.qty])).toEqual([["p1", 2], ["p2", 1]]);
    // y quedó persistido
    expect(loadCart("olivia")).toHaveLength(2);
  });

  it("setCartQty actualiza y elimina al llegar a 0", () => {
    saveCart("olivia", [line("p1", "Anillo Blossom", 1), line("p2", "Aretes Luna", 1)]);
    expect(setCartQty("olivia", "p1", 4).find((l) => l.productSlug === "p1")?.qty).toBe(4);
    const after = setCartQty("olivia", "p2", 0);
    expect(after.map((l) => l.productSlug)).toEqual(["p1"]);
    expect(loadCart("olivia").map((l) => l.productSlug)).toEqual(["p1"]);
  });

  it("limita agregar y cambiar cantidad a la existencia pública", () => {
    const item = { productId: "p1", productSlug: "p1", name: "Anillo", sku: "A", availableQuantity: 2 };
    expect(addToCart("olivia", item, 5).find((line) => line.productSlug === "p1")?.qty).toBe(2);
    expect(setCartQty("olivia", "p1", 8).find((line) => line.productSlug === "p1")?.qty).toBe(2);
    expect(setCartQty("olivia", "p1", 0)).toEqual([]);
  });

  it("no agrega una pieza agotada y refrescar elimina cantidades que ya no existen", () => {
    const item = { productSlug: "p1", name: "Anillo", sku: "A", availableQuantity: 0 };
    expect(addToCart("olivia", item)).toEqual([]);
    saveCart("olivia", [{ ...item, availableQuantity: 4, qty: 4 }]);
    expect(refreshCart("olivia", [{ ...item, availableQuantity: 2 }])[0]?.qty).toBe(2);
  });

  it("removeCartLine quita solo esa línea", () => {
    saveCart("olivia", [line("p1", "A", 1), line("p2", "B", 2), line("p3", "C", 3)]);
    expect(removeCartLine("olivia", "p2").map((l) => l.productSlug)).toEqual(["p1", "p3"]);
  });

  it("actualiza precios públicos de un carrito persistido sin cambiar cantidades", () => {
    saveCart("olivia", [line("p1", "Nombre anterior", 3)]);
    const refreshed = refreshCart("olivia", [{
      productSlug: "p1",
      name: "Anillo Blossom",
      sku: "SKU-p1",
      unitPrices: { t_retail: 140, t_wholesale: 105, t_reseller: 55 },
    }]);
    expect(refreshed[0]).toMatchObject({
      name: "Anillo Blossom",
      qty: 3,
      unitPrices: { t_retail: 140, t_wholesale: 105, t_reseller: 55 },
    });
    expect(loadCart("olivia")[0].qty).toBe(3);
  });
});

describe("cart proyección al renderizar", () => {
  it("descarta en silencio líneas cuya pieza ya no está en el catálogo público", () => {
    const lines = [line("p1", "A", 1), line("p2", "B", 2), line("p3", "C", 1)];
    const pruned = pruneCartLines(lines, new Set(["p1", "p3"]));
    expect(pruned.map((l) => l.productSlug)).toEqual(["p1", "p3"]);
  });

  it("cartPieces suma cantidades", () => {
    expect(cartPieces([line("p1", "A", 2), line("p2", "B", 3)])).toBe(5);
    expect(cartPieces([])).toBe(0);
  });
});
