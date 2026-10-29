import { createRequire } from "node:module";

// E0 — unit tests for the read-only Excel trial script (scripts/excel-trial-report.cjs),
// following the backfill-public-product-store-ids pattern: load the CJS module and
// declare its surface here.

interface Cell {
  col: string;
  row: number;
  type: string;
  value: number | string | null;
  formula: string | null;
}

interface Sheet {
  cells: Map<string, Cell>;
  merges: string[];
}

interface Issue {
  id: string;
  sheet: string;
  detail: string;
  refs: string[];
  duplicates?: unknown[];
  splitFactors?: Record<string, number>;
  months?: Record<string, number>;
  status?: Record<string, number>;
}

interface ExcelTrialModule {
  parseSharedStrings(xml: string): string[];
  parseSheet(xml: string, shared: string[]): Sheet;
  normalizeName(name: string): string;
  anonymizeName(name: string): string;
  serialDateToIso(serial: number): string | null;
  detectInventoryIssues(sheet: Sheet, dataFrom?: number, dataTo?: number): Issue[];
  detectSalesIssues(
    sheet: Sheet,
    sheetName: string,
    opts: {
      dataFrom: number;
      dataTo: number;
      qtyCol?: string;
      priceCol?: string;
      splitCols?: string[];
      subtotalCells?: { subtotalRef: string; sumFrom: number; sumTo: number; col: string }[];
      statusCol?: string | null;
      packingCol?: string | null;
    }
  ): Issue[];
}

const mod: ExcelTrialModule = createRequire(import.meta.url)("../../scripts/excel-trial-report.cjs");

// --- fixtures -------------------------------------------------------------

/** Build a minimal sheet XML from rows of cells. */
function sheetXml(rows: { ref: string; type?: string; value?: string; formula?: string }[], merges: string[] = []): string {
  const byRow = new Map<number, string[]>();
  for (const c of rows) {
    const rowNumber = Number(/[A-Z]+(\d+)/.exec(c.ref)![1]);
    const attrs = `r="${c.ref}"${c.type ? ` t="${c.type}"` : ""} s="1"`;
    const body = `${c.formula != null ? `<f>${c.formula}</f>` : ""}${c.value != null ? `<v>${c.value}</v>` : ""}`;
    const cell = body ? `<c ${attrs}>${body}</c>` : `<c ${attrs}/>`;
    byRow.set(rowNumber, [...(byRow.get(rowNumber) ?? []), cell]);
  }
  const rowXml = [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, cells]) => `<row r="${n}">${cells.join("")}</row>`)
    .join("");
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${rowXml}${mergeXml}</worksheet>`;
}

const SHARED = ["", "Aretes de Luna", "Aretes De Luna", "Sofía", "sofía ", "PAGADO", "NO PAGADO"];

// --- parser ---------------------------------------------------------------

describe("parseSharedStrings", () => {
  it("concatenates rich-text runs and decodes entities", () => {
    const xml = `<sst><si><t>Costo &amp; utilidad</t></si><si><r><t>Aretes</t></r><r><t> de Luna</t></r></si></sst>`;
    expect(mod.parseSharedStrings(xml)).toEqual(["Costo & utilidad", "Aretes de Luna"]);
  });
});

describe("parseSheet", () => {
  it("reads shared strings, numbers, cached formulas, errors and merges", () => {
    const xml = sheetXml(
      [
        { ref: "A1", type: "s", value: "1" },
        { ref: "C1", value: "4" },
        { ref: "E1", formula: "D1/C1+F1", value: "9.3" },
        { ref: "E2", type: "e", value: "#DIV/0!" },
        { ref: "F1" },
      ],
      ["A3:B3"]
    );
    const sheet = mod.parseSheet(xml, SHARED);
    expect(sheet.cells.get("A1")!.value).toBe("Aretes de Luna");
    expect(sheet.cells.get("C1")!.value).toBe(4);
    expect(sheet.cells.get("E1")!.formula).toBe("D1/C1+F1");
    expect(sheet.cells.get("E1")!.value).toBeCloseTo(9.3);
    expect(sheet.cells.get("E2")!.type).toBe("e");
    expect(sheet.cells.get("F1")!.value).toBeNull();
    expect(sheet.merges).toEqual(["A3:B3"]);
  });
});

// --- helpers --------------------------------------------------------------

describe("normalizeName / anonymizeName", () => {
  it("normalizes case and spacing for duplicate detection", () => {
    expect(mod.normalizeName(SHARED[1])).toBe(mod.normalizeName(SHARED[2]));
    // Capitalization and trailing spaces must collapse — they are the same customer.
    expect(mod.normalizeName(SHARED[3])).toBe(mod.normalizeName(SHARED[4]));
    expect(mod.normalizeName("sofía ")).toBe("sofía");
    expect(mod.normalizeName("Ana")).not.toBe(mod.normalizeName("Sofía"));
  });

  it("anonymizes without leaking the original name", () => {
    const alias = mod.anonymizeName("Fernanda López");
    expect(alias).toMatch(/^F\. \([0-9a-f]{4}\)$/);
    expect(alias).not.toContain("Fernanda");
  });
});

describe("serialDateToIso", () => {
  it("converts Excel serials to ISO dates", () => {
    expect(mod.serialDateToIso(45839)).toBe("2025-07-01"); // sanity anchor
    expect(mod.serialDateToIso(46284)).toBe("2026-09-19"); // 45839 + 445 days
    expect(mod.serialDateToIso(NaN)).toBeNull();
  });
});

// --- detectors ------------------------------------------------------------

describe("detectInventoryIssues", () => {
  const xml = sheetXml([
    { ref: "A5", type: "s", value: "1" },
    { ref: "B5", type: "s", value: "1" }, // product name
    { ref: "C5", value: "4" },
    { ref: "D5", value: "25.88" },
    { ref: "E5", formula: "D5/C5+F5", value: "9.3" },
    { ref: "F5", value: "2.83" },
    { ref: "M5", formula: "J5*0.15", value: "7.6" },
    // I1: packing without purchase data
    { ref: "F10", value: "2.83" },
    // I3 + I4: duplicate name and qty without cost
    { ref: "B12", type: "s", value: "2" }, // same normalized name as B5
    { ref: "C12", value: "3" },
    // I2: error cells in cost column — Excel serializes t="e", Numbers t="str" with the error text.
    { ref: "E15", type: "e", value: "#DIV/0!" },
    { ref: "E16", type: "str", value: "#DIV/0!" },
  ]);
  const issues = mod.detectInventoryIssues(mod.parseSheet(xml, SHARED), 5, 20);

  it("detects packing without purchase (I1)", () => {
    expect(issues.find((i) => i.id === "I1")?.detail).toContain("1 filas");
  });
  it("detects error cells in both serializations (I2)", () => {
    const refs = issues.find((i) => i.id === "I2")?.refs;
    expect(refs).toContain("E15");
    expect(refs).toContain("E16");
  });
  it("detects duplicate product names (I3)", () => {
    expect(issues.find((i) => i.id === "I3")?.duplicates).toHaveLength(1);
  });
  it("detects quantity without cost (I4)", () => {
    expect(issues.find((i) => i.id === "I4")?.refs).toContain("C12");
  });
  it("collects split factors from formulas (I6)", () => {
    expect(issues.find((i) => i.id === "I6")?.splitFactors).toEqual({ "0.15": 1 });
  });
});

describe("detectSalesIssues", () => {
  const xml = sheetXml([
    { ref: "A3", type: "s", value: "3" }, // customer (merged block header)
    { ref: "C3", value: "46284" }, // date 2026-09-22
    { ref: "F3", value: "1" },
    { ref: "H3", value: "65" },
    { ref: "K3", formula: "J3*0.2", value: "10" },
    // V4: qty > 1 with line-total semantics to confirm
    { ref: "F5", value: "5" },
    { ref: "H5", value: "325" },
    { ref: "K5", formula: "J5*0.5", value: "50" },
    // V5: duplicate customer name (different case/space)
    { ref: "A8", type: "s", value: "4" }, // "sofía " → same as "Sofía" normalized
    { ref: "C8", value: "46323" }, // 2026-10-01 (different month → V2)
    { ref: "F8", value: "1" },
    // V1: subtotal that omits rows above
    { ref: "K12", value: "10" },
    { ref: "K13", value: "20" },
    { ref: "K23", value: "30" },
    { ref: "K28", formula: "SUM(K23:K27)", value: "30" },
    // O1/O2: October status with profit formulas on unpaid rows
    { ref: "P30", type: "s", value: "6" }, // NO PAGADO
    { ref: "L30", formula: "H30-SUM(I30:K30)", value: "5" },
    { ref: "P31", type: "s", value: "5" }, // PAGADO
    // O3b: packing different from 2.83
    { ref: "I33", value: "2" },
  ]);
  const sheet = mod.parseSheet(xml, SHARED);
  const issues = mod.detectSalesIssues(sheet, "Ventas Oct", {
    dataFrom: 3,
    dataTo: 40,
    statusCol: "P",
    packingCol: "I",
    subtotalCells: [{ subtotalRef: "K28", sumFrom: 12, sumTo: 27, col: "K" }],
    splitCols: ["K"],
  });

  it("detects rows with quantity > 1 (V4/O3)", () => {
    expect(issues.find((i) => i.id === "O3")?.refs).toContain("F5");
  });
  it("detects split factors (V3)", () => {
    expect(issues.find((i) => i.id === "V3")?.splitFactors).toEqual({ "0.2": 1, "0.5": 1 });
  });
  it("detects subtotal gaps (V1)", () => {
    const v1 = issues.find((i) => i.id === "V1");
    expect(v1?.refs).toContain("K28");
    // Cached 30 vs actual 60 (K12 + K13 + K23) → gap of 30.
    expect(v1 && (v1 as unknown as { gap: number }).gap).toBeCloseTo(30);
  });
  it("groups dates by month (V2)", () => {
    const months = issues.find((i) => i.id === "V2")?.months;
    expect(months).toEqual({ "2026-09": 1, "2026-10": 1 });
  });
  it("detects duplicate customer names, anonymized (V5)", () => {
    const v5 = issues.find((i) => i.id === "V5");
    expect(v5?.duplicates).toHaveLength(1);
    expect(JSON.stringify(v5)).not.toContain("Sofía");
    expect(JSON.stringify(v5)).not.toContain("sofía");
  });
  it("counts payment statuses (O1)", () => {
    const status = issues.find((i) => i.id === "O1")?.status;
    expect(status?.PAGADO).toBe(1);
    expect(status?.["NO PAGADO"]).toBe(1);
  });
  it("flags profit formulas on NO PAGADO rows (O2)", () => {
    expect(issues.find((i) => i.id === "O2")?.refs).toContain("P30");
  });
  it("flags packing values different from 2.83 (O3b)", () => {
    expect(issues.find((i) => i.id === "O3b")?.refs[0]).toContain("I33");
  });
});
