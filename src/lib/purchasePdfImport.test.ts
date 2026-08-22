import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseMoney,
  parseSupplierOrder,
  reconcileAmountType,
} from "../../functions/src/parser";

// The fixture is the real OCR output of Fer's supplier PDF (5 pages), with
// `=== render-N.png ===` page markers — the §31 regression suite.
const realOcr = readFileSync(
  join(__dirname, "../../functions/src/__fixtures__/receipt-ocr.txt"),
  "utf8"
);

describe("parseMoney", () => {
  it("parses MX formats with either decimal separator", () => {
    expect(parseMoney("193,20")).toBe(193.2);
    expect(parseMoney("10.001,68")).toBe(10001.68);
    expect(parseMoney("1,234.50")).toBe(1234.5);
    expect(parseMoney("4410")).toBe(4410);
    expect(parseMoney("abc")).toBeUndefined();
  });
});

describe("parseSupplierOrder — §31 fixture regression", () => {
  const parsed = parseSupplierOrder(realOcr);

  it("detects order number, date label and currency", () => {
    expect(parsed.supplierOrder).toBe("3023");
    expect(parsed.dateLabel).toMatch(/^ago 19$/i);
    expect(parsed.currency).toBe("MXN");
  });

  it("suggests the supplier from the Tienda section", () => {
    expect(parsed.supplierCandidate).toBe("Colore");
  });

  it("detects totals: subtotal/total, discount, tax; shipping free", () => {
    expect(parsed.subtotal).toBe(10001.68);
    expect(parsed.total).toBe(10001.68);
    expect(parsed.discount).toBe(18574.77);
    expect(parsed.taxIncluded).toBe(1379.55);
    expect(parsed.shipping).toBe(0);
  });

  it("first product is real merchandise, never the document header", () => {
    const first = parsed.lines[0];
    expect(first.name).toMatch(/^Brazalete tubular flor/i);
    expect(first.name).not.toMatch(/recibo/i);
    expect(first.name).not.toMatch(/pedido/i);
    expect(first.sourceAmount).toBe(193.2);
  });

  it("first product: variant Dorado, quantity 3", () => {
    expect(parsed.lines[0].variant).toBe("Dorado");
    expect(parsed.lines[0].quantity).toBe(3);
  });

  it("second product has quantity 4 (bare number)", () => {
    expect(parsed.lines[1].quantity).toBe(4);
  });

  it("preserves ×2/×3 multipliers throughout", () => {
    const x2 = parsed.lines.filter((l) => l.quantity === 2);
    const x3 = parsed.lines.filter((l) => l.quantity === 3);
    expect(x2.length).toBeGreaterThanOrEqual(10);
    expect(x3.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps Dorado/Plateado and ring letters as variants", () => {
    const variants = new Set(parsed.lines.map((l) => l.variant));
    expect(variants.has("Dorado")).toBe(true);
    expect(variants.has("Plateado")).toBe(true);
    const letters = parsed.lines.filter((l) => l.variant && l.variant.length === 1);
    expect(letters.length).toBeGreaterThanOrEqual(5); // N, R, A, D, E…
  });

  it("stitches items split across page boundaries (1→2)", () => {
    // Page 1 ends "Anillo ajustable eslabon italiano" and page 2 starts
    // "cerezas y circonias 94,50 MXN" — must be ONE line, not two.
    const stitched = parsed.lines.find((l) =>
      /eslabon italiano/i.test(l.name) && /cerezas/i.test(l.name)
    );
    expect(stitched).toBeDefined();
    expect(stitched!.sourceAmount).toBe(94.5);
  });

  it("never turns totals or addresses into merchandise", () => {
    for (const l of parsed.lines) {
      expect(l.name).not.toMatch(/subtotal|descuento|env[íi]o|^total|impuestos/i);
      expect(l.name).not.toMatch(/direcci[óo]n|correo|facturaci[óo]n|guadalajara|ch[áa]vez|@/i);
    }
  });

  it("recognizes unreconcilable amounts → unknown + needsReview, not an error", () => {
    // Σ sourceAmount (~7.9k) and Σ×qty (~15k) both miss 10,001.68: the doc's
    // Descuento is internally inconsistent. The result is review, not failure.
    expect(parsed.sourceAmountType).toBe("unknown");
    expect(parsed.needsReview).toBe(true);
  });

  it("does not invent unit costs when semantics are unknown", () => {
    for (const l of parsed.lines) expect(l.unitCost).toBeUndefined();
  });

  it("extracts EXACTLY the 50 merchandise rows of the real PDF", () => {
    // The fixture's OCR carries all 50 amounts; the parser must not merge any
    // two of them (regression: "124,650" and "4410 MXN" used to miss the
    // price regex and fuse with the next item).
    expect(parsed.lines.length).toBe(50);
  });

  it("keeps the trailing-zero decimal as its own row (124,650 → 124.65)", () => {
    const l = parsed.lines.find((x) => x.sourceAmount === 124.65);
    expect(l).toBeDefined();
    expect(l!.name).toMatch(/panza de vibora y de eslabon/i);
    expect(l!.quantity).toBe(2);
  });

  it("reads the separator-dropped integer amount (4410 MXN → 44.10)", () => {
    const l = parsed.lines.find((x) => x.sourceAmount === 44.1);
    expect(l).toBeDefined();
    expect(l!.name).toMatch(/ajustable italiano liso/i);
    expect(l!.variant).toBe("Plateado");
    // The item that followed must NOT be fused with it.
    const tobillera = parsed.lines.find((x) => /Tobillera de sol/i.test(x.name));
    expect(tobillera).toBeDefined();
    expect(tobillera!.sourceAmount).toBe(39.9);
    expect(tobillera!.name).not.toMatch(/plateado/i);
  });

  it("rejoins a name fragment that OCR placed after the price (herradura)", () => {
    const herradura = parsed.lines.find((l) =>
      /eslabon italiano herradura con circonias/i.test(l.name)
    );
    expect(herradura).toBeDefined();
    expect(herradura!.sourceAmount).toBe(24.5);
    // The next row (letra D) must not carry the leaked fragment.
    const d = parsed.lines.find((l) => l.variant === "D");
    expect(d!.sourceAmount).toBe(24.15);
    expect(d!.name).not.toMatch(/herradura/i);
  });
});

describe("reconcileAmountType", () => {
  const lines = [
    { sourceAmount: 100, quantity: 2 },
    { sourceAmount: 50, quantity: 1 },
  ];
  it("A matches → line", () => {
    expect(reconcileAmountType(lines, 150)).toBe("line");
  });
  it("B matches → unit", () => {
    expect(reconcileAmountType(lines, 250)).toBe("unit");
  });
  it("neither → unknown", () => {
    expect(reconcileAmountType(lines, 999)).toBe("unknown");
    expect(reconcileAmountType([], 100)).toBe("unknown");
  });
});

describe("parseSupplierOrder (synthetic)", () => {
  it("handles a simple tabular order with unit amounts", () => {
    const out = parseSupplierOrder(
      ["Pedido: 9988 - 12 may 25", "Anillo plata", "talla 7 250.00 MXN", "x2", "Total 500.00 MXN"].join("\n")
    );
    expect(out.supplierOrder).toBe("9988");
    expect(out.lines[0].name).toContain("Anillo");
    expect(out.lines[0].sourceAmount).toBe(250);
    expect(out.lines[0].quantity).toBe(2);
    expect(out.total).toBe(500);
    expect(out.sourceAmountType).toBe("unit");
    expect(out.needsReview).toBe(false);
  });

  it("returns empty lines for text without prices", () => {
    expect(parseSupplierOrder("hola\nmundo").lines).toHaveLength(0);
  });
});
