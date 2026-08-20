import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMoney, parseSupplierOrder } from "../../functions/src/parser";

// The fixture is the real OCR output of Fer's supplier PDF (5 pages).
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

describe("parseSupplierOrder (real OCR fixture)", () => {
  const parsed = parseSupplierOrder(realOcr);

  it("extracts the order number and date label", () => {
    expect(parsed.supplierOrder).toBe("3023");
    expect(parsed.dateLabel).toMatch(/ago 19/i);
  });

  it("extracts the totals", () => {
    expect(parsed.subtotal).toBe(10001.68);
    expect(parsed.total).toBe(10001.68);
  });

  it("extracts at least 40 item lines with prices", () => {
    expect(parsed.lines.length).toBeGreaterThanOrEqual(40);
    for (const l of parsed.lines) {
      expect(l.name.length).toBeGreaterThan(3);
      expect(l.unitAmount).toBeGreaterThan(0);
    }
  });

  it("recognizes the first line: name, color, quantity, price", () => {
    const first = parsed.lines[0];
    expect(first.name).toMatch(/Brazalete tubular flor/i);
    expect(first.unitAmount).toBe(193.2);
    expect(first.color).toBe("dorado");
    expect(first.quantity).toBe(3);
  });

  it("never invents quantities (default 1)", () => {
    expect(parsed.lines.every((l) => l.quantity >= 1)).toBe(true);
  });
});

describe("parseSupplierOrder (synthetic)", () => {
  it("handles a simple tabular order", () => {
    const out = parseSupplierOrder(
      ["Pedido: 9988 - 12 may 25", "Anillo plata", "talla 7 250.00 MXN", "x2", "Total 500.00 MXN"].join("\n")
    );
    expect(out.supplierOrder).toBe("9988");
    expect(out.lines[0].name).toContain("Anillo");
    expect(out.lines[0].unitAmount).toBe(250);
    expect(out.lines[0].quantity).toBe(2);
    expect(out.total).toBe(500);
  });

  it("returns empty lines for text without prices", () => {
    expect(parseSupplierOrder("hola\nmundo").lines).toHaveLength(0);
  });
});
