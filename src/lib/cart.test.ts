import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCart,
  saveCart,
  addToCart,
  setCartQty,
  removeCartLine,
  pruneCartLines,
  cartPieces,
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

  it("removeCartLine quita solo esa línea", () => {
    saveCart("olivia", [line("p1", "A", 1), line("p2", "B", 2), line("p3", "C", 3)]);
    expect(removeCartLine("olivia", "p2").map((l) => l.productSlug)).toEqual(["p1", "p3"]);
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
