// @vitest-environment jsdom
// #253 — the suggestion math behind "Empaques" at order prep.
import { describe, it, expect } from "vitest";
import { suggestOrderPackaging } from "./packaging";
import type { Order, StorePackaging } from "../types";

const packaging: StorePackaging = {
  materials: [
    { id: "m_bolsa", name: "Bolsa transparente", estimatedCost: 0.5, supplyExpenseId: "exp_bolsas" },
    { id: "m_carton", name: "Cartoncito", estimatedCost: 0.198 },
    { id: "m_rosa", name: "Bolsa rosa", estimatedCost: 3 },
    { id: "m_mono", name: "Moño", estimatedCost: 0.43, supplyExpenseId: "exp_monos" },
    { id: "m_paleta", name: "Paleta", estimatedCost: 2 },
  ],
  byTier: {
    // Iconic: bolsa per piece, NO cartoncito; per order: rosa + moño + paleta.
    t_iconic: {
      perPiece: [{ materialId: "m_bolsa", units: 1 }],
      perOrder: [
        { materialId: "m_rosa", units: 1 },
        { materialId: "m_mono", units: 1 },
        { materialId: "m_paleta", units: 1 },
      ],
    },
    // Regular/Girly: bolsa + cartoncito per piece; same per-order set.
    t_retail: {
      perPiece: [
        { materialId: "m_bolsa", units: 1 },
        { materialId: "m_carton", units: 1 },
      ],
      perOrder: [
        { materialId: "m_rosa", units: 1 },
        { materialId: "m_mono", units: 1 },
        { materialId: "m_paleta", units: 1 },
      ],
    },
  },
};

function order(items: Order["items"]): Pick<Order, "items"> {
  return { items };
}

function line(suggestion: ReturnType<typeof suggestOrderPackaging>, materialId: string) {
  return suggestion.lines.find((l) => l.materialId === materialId);
}

describe("suggestOrderPackaging (#253)", () => {
  it("pedido Iconic de 10 piezas: 10 bolsas sin cartoncito y el set por pedido una sola vez", () => {
    const s = suggestOrderPackaging({
      order: order([{ productName: "Anillo", quantity: 10, unitPrice: 60, subtotal: 600, priceTier: "t_iconic" }]),
      packaging,
    });
    expect(line(s, "m_bolsa")?.units).toBe(10);
    expect(line(s, "m_carton")).toBeUndefined();
    expect(line(s, "m_rosa")?.units).toBe(1);
    expect(line(s, "m_mono")?.units).toBe(1);
    expect(line(s, "m_paleta")?.units).toBe(1);
  });

  it("pedido Regular de 1 pieza: bolsa + cartoncito y el set por pedido completo", () => {
    const s = suggestOrderPackaging({
      order: order([{ productName: "Reloj", quantity: 1, unitPrice: 290, subtotal: 290, priceTier: "t_retail" }]),
      packaging,
    });
    expect(line(s, "m_bolsa")?.units).toBe(1);
    expect(line(s, "m_carton")?.units).toBe(1);
    expect(line(s, "m_rosa")?.units).toBe(1);
  });

  it("pedido mixto: los materiales por pieza usan el nivel de CADA línea y el set por pedido va una vez (nivel dominante)", () => {
    const s = suggestOrderPackaging({
      order: order([
        { productName: "Aretes", quantity: 3, unitPrice: 60, subtotal: 180, priceTier: "t_iconic" },
        { productName: "Reloj", quantity: 1, unitPrice: 290, subtotal: 290, priceTier: "t_retail" },
      ]),
      packaging,
    });
    expect(line(s, "m_bolsa")?.units).toBe(4); // 3 Iconic + 1 Retail
    expect(line(s, "m_carton")?.units).toBe(1); // solo la pieza Retail
    expect(line(s, "m_rosa")?.units).toBe(1); // una vez por pedido
    expect(s.perPieceByTier).toEqual([
      { tier: "t_iconic", pieces: 3 },
      { tier: "t_retail", pieces: 1 },
    ]);
  });

  it("línea sin nivel cae al nivel de la clienta (fallbackTier)", () => {
    const s = suggestOrderPackaging({
      order: order([{ productName: "Anillo", quantity: 2, unitPrice: 60, subtotal: 120 }]),
      packaging,
      fallbackTier: "t_iconic",
    });
    expect(line(s, "m_bolsa")?.units).toBe(2);
    expect(line(s, "m_rosa")?.units).toBe(1);
  });

  it("nivel sin perfil configurado no aporta materiales", () => {
    const s = suggestOrderPackaging({
      order: order([{ productName: "Pieza", quantity: 5, unitPrice: 10, subtotal: 50, priceTier: "t_girly" }]),
      packaging,
    });
    expect(s.lines).toEqual([]);
    expect(s.estimatedCostTotal).toBe(0);
  });

  it("sin empaques configurados la sugerencia es vacía y estable", () => {
    const s = suggestOrderPackaging({
      order: order([{ productName: "Anillo", quantity: 3, unitPrice: 60, subtotal: 180, priceTier: "t_iconic" }]),
      packaging: undefined,
    });
    expect(s.lines).toEqual([]);
    expect(s.estimatedCostTotal).toBe(0);
  });

  it("el costo estimado suma unidades × costo y las líneas llevan el suministro vinculado", () => {
    const s = suggestOrderPackaging({
      order: order([{ productName: "Anillo", quantity: 4, unitPrice: 60, subtotal: 240, priceTier: "t_iconic" }]),
      packaging,
    });
    // 4 bolsas × $0.50 + rosa $3 + moño $0.43 + paleta $2 = $7.43
    expect(s.estimatedCostTotal).toBeCloseTo(7.43, 10);
    expect(line(s, "m_bolsa")?.supplyExpenseId).toBe("exp_bolsas");
    expect(line(s, "m_paleta")?.supplyExpenseId).toBeUndefined();
  });

  it("el mismo material en por pieza y por pedido se acumula en una sola línea", () => {
    const mixed: StorePackaging = JSON.parse(JSON.stringify(packaging));
    mixed.byTier.t_iconic.perOrder.push({ materialId: "m_bolsa", units: 1 }); // bolsa extra por pedido
    const s = suggestOrderPackaging({
      order: order([{ productName: "Anillo", quantity: 3, unitPrice: 60, subtotal: 180, priceTier: "t_iconic" }]),
      packaging: mixed,
    });
    expect(line(s, "m_bolsa")?.units).toBe(4); // 3 por pieza + 1 por pedido
    expect(s.lines.filter((l) => l.materialId === "m_bolsa")).toHaveLength(1);
  });

  it("pedido sin items es estable", () => {
    const s = suggestOrderPackaging({ order: { items: undefined } as unknown as Pick<Order, "items">, packaging });
    expect(s.lines).toEqual([]);
  });

  it("empate de piezas: gana el primer nivel en orden de líneas (documentado)", () => {
    const s = suggestOrderPackaging({
      order: order([
        { productName: "A", quantity: 2, unitPrice: 1, subtotal: 2, priceTier: "t_iconic" },
        { productName: "B", quantity: 2, unitPrice: 1, subtotal: 2, priceTier: "t_retail" },
      ]),
      packaging,
    });
    expect(line(s, "m_carton")?.units).toBe(2); // perOrder del iconic (primero) NO lleva cartoncito; retail sí → 2 piezas retail
    // El set por pedido viene del dominante (empate → t_iconic, primero): una sola bolsa rosa.
    expect(line(s, "m_rosa")?.units).toBe(1);
  });

  it("cantidades fraccionarias o nulas no rompen la aritmética", () => {
    const s = suggestOrderPackaging({
      order: order([
        { productName: "A", quantity: 2.4, unitPrice: 1, subtotal: 2.4, priceTier: "t_iconic" },
        { productName: "B", quantity: 0, unitPrice: 1, subtotal: 0, priceTier: "t_iconic" },
      ]),
      packaging,
    });
    expect(line(s, "m_bolsa")?.units).toBe(2); // 2.4 redondea a 2; 0 no aporta
  });
});
