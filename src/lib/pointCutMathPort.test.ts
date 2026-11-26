// #524 — planCorte lockstep: the functions-side port must produce plans
// identical to the app's TypeScript source of truth for every fixture
// (creditMath idiom). If they diverge, the trusted callable would compute a
// different corte than the preview Fer approved — the test fails and the
// port must not ship.
import { describe, expect, it } from "vitest";
import { planCorte, type CorteLineInput, type CorteWriteOffInput } from "./pointOfSale";
import { planCortePort } from "../../functions/src/pointCutMath.mjs";

type PortEntry = Parameters<typeof planCortePort>[0][number];
type PortLine = CorteLineInput;
type PortWriteOff = CorteWriteOffInput;

const NOW = "2026-11-21T12:00:00.000Z";
const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  pointId: "pt1",
  productId: "p1",
  productName: "Reloj",
  entryDate: "2026-11-01",
  quantity: 10,
  consumedQty: 0,
  markedPriceCents: 10000,
  unitCostCents: 5000,
  createdAt: NOW,
  ...over,
});

describe("planCorte TS ↔ mjs port lockstep (#524)", () => {
  const cases: Array<{ name: string; entries: PortEntry[]; lines: PortLine[]; writeOffs: PortWriteOff[]; rate: number }> = [
    { name: "ejemplo de la issue", entries: [entry("e1")], lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 5 }], writeOffs: [{ productId: "p1", markedPriceCents: 10000, qty: 1, reason: "Dañada" }], rate: 0.2 },
    { name: "dos entradas FIFO con venta y baja cruzadas", entries: [entry("e1", { quantity: 3 }), entry("e2", { entryDate: "2026-11-10", quantity: 3 })], lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 2 }], writeOffs: [{ productId: "p1", markedPriceCents: 10000, qty: 2, reason: "Robo" }], rate: 0.2 },
    { name: "precios mezclados con precio elegido", entries: [entry("e100", { quantity: 3, markedPriceCents: 10000 }), entry("e120", { quantity: 4, entryDate: "2026-11-02", markedPriceCents: 12000 })], lines: [{ productId: "p1", markedPriceCents: 12000, soldQty: 2 }], writeOffs: [{ productId: "p1", markedPriceCents: 10000, qty: 1, reason: "Perdida" }], rate: 0.2 },
    { name: "costo faltante", entries: [entry("e1", { unitCostCents: undefined })], lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 1 }], writeOffs: [], rate: 0.2 },
    { name: "stock insuficiente", entries: [entry("e1")], lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 11 }], writeOffs: [], rate: 0.2 },
    { name: "comisión con centavos impares", entries: [entry("e1", { quantity: 3, markedPriceCents: 9999 })], lines: [{ productId: "p1", markedPriceCents: 9999, soldQty: 3 }], writeOffs: [], rate: 0.2 },
    { name: "variante y consumo previo", entries: [entry("e1", { variantId: "v-cafe", quantity: 8, consumedQty: 2 }), entry("e2", { variantId: "v-negra", quantity: 5, entryDate: "2026-11-05" })], lines: [{ productId: "p1", variantId: "v-cafe", markedPriceCents: 10000, soldQty: 4 }], writeOffs: [{ productId: "p1", variantId: "v-negra", markedPriceCents: 10000, qty: 2, reason: "Rayada" }], rate: 0.15 },
  ];

  for (const testCase of cases) {
    it(`produjo el mismo plan: ${testCase.name}`, () => {
      const ts = planCorte(testCase.entries, testCase.lines, testCase.writeOffs, testCase.rate);
      const port = planCortePort(testCase.entries, testCase.lines, testCase.writeOffs, testCase.rate);
      expect(port).toEqual(ts);
    });
  }
});
