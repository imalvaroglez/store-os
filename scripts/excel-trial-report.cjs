#!/usr/bin/env node
// E0 — Read-only Excel trial report (OLI-35 groundwork).
// Parses `Ventas .xlsx` (Inventario / Ventas Ago - Sep / Ventas Oct) without modifying it,
// detects the documented incidences, and writes report.json + an anonymized summary.md.
// Zero new dependencies: an .xlsx is a ZIP of XML, unzipped with the system `unzip`.
//
// Usage: node scripts/excel-trial-report.cjs <path-to-xlsx> [--out <dir>]
// The lib functions below are unit-tested from src/lib/excel-trial.test.ts.

"use strict";

const { execSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------------
// XML primitives (OOXML sheets are single-line serializations; regex parsing
// is adequate for read-only extraction of rows/cells/merges).

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&"); // amp last: entities above may contain it.
}

/** Parse xl/sharedStrings.xml into the string table (rich text runs concatenated). */
function parseSharedStrings(xml) {
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  return items.map((si) => {
    const texts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    return decodeXmlEntities(texts.map((t) => t.replace(/<[^>]+>/g, "")).join(""));
  });
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

/**
 * Parse a worksheet XML into { cells, merges, maxRow, maxCol }.
 * cells: Map<ref, { col, row, type, value, formula }> — value is the cached
 * value (number | string) or null for empty cells; formula is the formula text
 * when present (shared formulas carry it only on the first cell of the group).
 */
function parseSheet(xml, shared) {
  const cells = new Map();
  const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row[^>]*\br="(\d+)"[^>]*\/>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowNumber = Number(rowMatch[1] ?? rowMatch[3]);
    const rowBody = rowMatch[2] ?? "";
    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowBody)) !== null) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const refMatch = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!refMatch) continue;
      const ref = refMatch[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null;
      const formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? null;
      let value = null;
      if (raw != null) {
        if (type === "s") value = shared[Number(raw)] ?? null;
        else if (type === "n" || type === "str" || type === "e" || type === "b") {
          value = decodeXmlEntities(raw);
          if (type === "n" && value !== "" && Number.isFinite(Number(value))) value = Number(value);
        }
      }
      const { col, row } = splitRef(ref);
      cells.set(ref, { col, row, type, value, formula });
    }
    void rowNumber;
  }
  const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map((m) => m[1]);
  return { cells, merges };
}

function cellAt(sheet, ref) {
  return sheet.cells.get(ref) ?? null;
}

/** Value of a cell coerced for display: numbers as-is, else string, else null. */
function valueOf(sheet, ref) {
  const c = cellAt(sheet, ref);
  return c ? c.value : null;
}

/** Column letter → list of {ref, cell} for rows in [from, to], sorted by row. */
function columnCells(sheet, col, fromRow, toRow) {
  const out = [];
  for (const [ref, cell] of sheet.cells) {
    if (cell.col === col && cell.row >= fromRow && cell.row <= toRow) out.push({ ref, cell });
  }
  return out.sort((a, b) => a.cell.row - b.cell.row);
}

// ---------------------------------------------------------------------------
// Business detectors. Each returns Issue[] entries for the report.

function issue(id, sheet, detail, refs = [], extra = {}) {
  return { id, sheet, detail, refs, ...extra };
}

/** Normalize a product/customer name for duplicate detection. */
function normalizeName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Anonymize a customer name for the committable summary: initial + short hash. */
function anonymizeName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) return "(vacío)";
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 4);
  const initial = normalized[0].toUpperCase();
  return `${initial}. (${hash})`;
}

/** Excel serial date → ISO date string (epoch 1899-12-30; serials > 60 only). */
function serialDateToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = days between epochs
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/**
 * Inventario sheet (headers row 3, data rows 5..~176, totals row ~178):
 *   A SKU proveedor · B producto · C cantidad · D costo total · E costo unitario
 *   F packing · G/H/I precios Regular/Girly/Iconic · J/K/L ganancia por nivel
 *   M..U repartos (15/50/35 en fórmulas).
 */
/** Sheet-error values look like #DIV/0!, #REF!, #VALUE! — Numbers caches them as t="str". */
function isErrorValue(cell) {
  return cell && (cell.type === "e" || (typeof cell.value === "string" && /^#[A-Z0-9/!?]+([!?])?$/.test(cell.value.trim())));
}

function detectInventoryIssues(sheet, dataFrom = 5, dataTo = 177) {
  const issues = [];
  const packingNoPurchase = [];
  const divErrors = [];
  const zeroCost = [];
  const names = new Map();
  const duplicates = [];
  const splitFactors = new Map(); // factor → count of formula cells

  for (let row = dataFrom; row <= dataTo + 1; row++) {
    const qty = valueOf(sheet, `C${row}`);
    const totalCost = valueOf(sheet, `D${row}`);
    const unitCost = cellAt(sheet, `E${row}`);
    const packing = valueOf(sheet, `F${row}`);

    // I1: packing captured without purchase data (qty/totalCost missing).
    if (packing != null && Number(packing) > 0 && (qty == null || Number(qty) === 0) && totalCost == null) {
      packingNoPurchase.push(`F${row}`); // point at the packing cell
    }
    // I2: cached errors (#DIV/0! etc.) anywhere in the row's cost columns.
    for (const col of ["C", "D", "E", "G", "H", "I", "J", "K", "L"]) {
      const c = cellAt(sheet, `${col}${row}`);
      if (isErrorValue(c)) divErrors.push(`${col}${row}`);
    }
    // I4: quantity > 0 with missing/zero cost data.
    if (qty != null && Number(qty) > 0 && (totalCost == null || Number(totalCost) === 0)) {
      zeroCost.push(`C${row}`);
    }
    // I3: duplicate product names (column B).
    const name = valueOf(sheet, `B${row}`);
    if (typeof name === "string" && name.trim() !== "") {
      const key = normalizeName(name);
      if (names.has(key)) duplicates.push({ name, rows: [names.get(key), `B${row}`] });
      else names.set(key, `B${row}`);
    }
  }
  // I6: split factors used in M..U formulas (0.15/0.5/0.35 expected here).
  for (let row = dataFrom; row <= dataTo + 1; row++) {
    for (const col of ["M", "N", "O", "P", "Q", "R", "S", "T", "U"]) {
      const c = cellAt(sheet, `${col}${row}`);
      const factor = c?.formula ? /\*\s*(0\.\d+)/.exec(c.formula)?.[1] : null;
      if (factor) splitFactors.set(factor, (splitFactors.get(factor) ?? 0) + 1);
    }
  }

  if (packingNoPurchase.length)
    issues.push(issue("I1", "Inventario", `Packing capturado sin datos de compra (C/D vacíos): ${packingNoPurchase.length} filas`, packingNoPurchase.slice(0, 20)));
  if (divErrors.length)
    issues.push(issue("I2", "Inventario", `Celdas con error en fórmula (p.ej. #DIV/0! por dividir entre cantidad vacía): ${divErrors.length}`, divErrors.slice(0, 20)));
  if (duplicates.length)
    issues.push(issue("I3", "Inventario", `Nombres de producto duplicados (normalizados): ${duplicates.length}`, [], { duplicates: duplicates.slice(0, 30) }));
  if (zeroCost.length)
    issues.push(issue("I4", "Inventario", `Cantidad > 0 con costo total vacío o cero: ${zeroCost.length} filas`, zeroCost.slice(0, 20)));
  if (splitFactors.size)
    issues.push(issue("I6", "Inventario", "Factores de reparto en fórmulas M:U", [], { splitFactors: Object.fromEntries(splitFactors) }));
  return issues;
}

/** Sales sheets share shape: A clienta · B(?) producto · C fecha · F cantidad · H precio/línea · I costo… */
function detectSalesIssues(sheet, sheetName, opts) {
  const issues = [];
  const { subtotalCells, qtyCol = "F", priceCol = "H", statusCol = null, packingCol = null, dataFrom, dataTo } = opts;

  // V4/O3: rows with quantity > 1 — line semantics (unit vs total) must be confirmed.
  const multiQty = [];
  for (let row = dataFrom; row <= dataTo; row++) {
    const qty = valueOf(sheet, `${qtyCol}${row}`);
    if (qty != null && Number(qty) > 1) multiQty.push(`${qtyCol}${row}`);
  }
  if (multiQty.length)
    issues.push(issue(sheetName === "Ventas Ago - Sep" ? "V4" : "O3", sheetName, `Renglones con cantidad > 1 (semántica de Precio/Costo total-línea a confirmar): ${multiQty.length}`, multiQty.slice(0, 20)));

  // V3: split factors in per-row profit formulas (0.2/0.5/0.3 expected).
  if (opts.splitCols) {
    const splitFactors = new Map();
    for (let row = dataFrom; row <= dataTo; row++) {
      for (const col of opts.splitCols) {
        const c = cellAt(sheet, `${col}${row}`);
        const factor = c?.formula ? /\*\s*(0\.\d+)/.exec(c.formula)?.[1] : null;
        if (factor) splitFactors.set(factor, (splitFactors.get(factor) ?? 0) + 1);
      }
    }
    if (splitFactors.size)
      issues.push(issue("V3", sheetName, "Factores de reparto en fórmulas de venta", [], { splitFactors: Object.fromEntries(splitFactors) }));
  }

  // V1: subtotal coverage — recompute the summed range vs the cached subtotal.
  if (subtotalCells) {
    for (const { subtotalRef, sumFrom, sumTo, col } of subtotalCells) {
      const cached = valueOf(sheet, subtotalRef);
      const f = cellAt(sheet, subtotalRef)?.formula;
      if (cached == null || !f) continue;
      const actual = columnCells(sheet, col, sumFrom, sumTo).reduce(
        (sum, { cell }) => sum + (typeof cell.value === "number" ? cell.value : 0),
        0
      );
      const gap = Math.round((actual - Number(cached)) * 100) / 100;
      if (Math.abs(gap) >= 0.01)
        issues.push(issue("V1", sheetName, `Subtotal ${subtotalRef} (${f}) difiere de la suma de ${col}${sumFrom}:${col}${sumTo} por $${gap.toFixed(2)}`, [subtotalRef], { cached, actual: Math.round(actual * 100) / 100, gap }));
    }
  }

  // V2: month attribution — collect dates (column C) and group by YYYY-MM.
  const dates = new Map();
  for (let row = dataFrom; row <= dataTo; row++) {
    const raw = valueOf(sheet, `C${row}`);
    if (raw == null || raw === "") continue;
    const iso = typeof raw === "number" ? serialDateToIso(raw) : typeof raw === "string" && /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
    if (iso) dates.set(iso.slice(0, 7), (dates.get(iso.slice(0, 7)) ?? 0) + 1);
  }
  if (dates.size)
    issues.push(issue("V2", sheetName, "Meses presentes en la columna de fecha (una hoja puede mezclar meses)", [], { months: Object.fromEntries(dates) }));

  // V5: customers from merged cells in column A — duplicates/variants.
  const customerCells = columnCells(sheet, "A", 1, dataTo).filter(
    ({ cell }) => typeof cell.value === "string" && cell.value.trim() !== "" && cell.value.trim().length > 1
  );
  const seen = new Map();
  const dupCustomers = [];
  for (const { cell } of customerCells) {
    const key = normalizeName(cell.value);
    if (seen.has(key)) dupCustomers.push({ rows: [seen.get(key), `A${cell.row}`], display: anonymizeName(cell.value) });
    else seen.set(key, `A${cell.row}`);
  }
  if (dupCustomers.length)
    issues.push(issue("V5", sheetName, `Clientas con nombre repetido (posibles variantes del mismo nombre): ${dupCustomers.length}`, [], { duplicates: dupCustomers.slice(0, 30) }));

  // O1: payment status counts (Ventas Oct column P).
  if (statusCol) {
    const status = new Map();
    for (let row = dataFrom; row <= dataTo; row++) {
      const v = valueOf(sheet, `${statusCol}${row}`);
      const key = v == null || v === "" ? "(vacío)" : String(v).trim().toUpperCase();
      if (key === "(VACÍO)" && v == null) continue; // structural gaps between blocks
      if (key === "(VACÍO)") status.set(key, (status.get(key) ?? 0) + 1);
      else if (/PAGADO/.test(key)) status.set(key, (status.get(key) ?? 0) + 1);
    }
    if (status.size)
      issues.push(issue("O1", sheetName, "Conteo de estatus de pago", [], { status: Object.fromEntries(status) }));
    // O2: profit/distribution formulas computed on NO PAGADO rows.
    const unpaidWithProfit = [];
    for (let row = dataFrom; row <= dataTo; row++) {
      const v = valueOf(sheet, `${statusCol}${row}`);
      if (v != null && /NO PAGADO/i.test(String(v))) {
        const hasProfit = ["L", "M", "N", "O"].some((col) => cellAt(sheet, `${col}${row}`)?.formula);
        if (hasProfit) unpaidWithProfit.push(`P${row}`);
      }
    }
    if (unpaidWithProfit.length)
      issues.push(issue("O2", sheetName, `Filas NO PAGADO con fórmulas de ganancia/reparto calculadas: ${unpaidWithProfit.length}`, unpaidWithProfit.slice(0, 20)));
  }

  // O3b (extra): October packing column values different from the 2.83 inventory constant.
  if (packingCol) {
    const others = [];
    for (let row = dataFrom; row <= dataTo; row++) {
      const v = valueOf(sheet, `${packingCol}${row}`);
      if (v != null && v !== "" && Number(v) > 0 && Math.abs(Number(v) - 2.83) >= 0.005) others.push(`${packingCol}${row}=${v}`);
    }
    if (others.length)
      issues.push(issue("O3b", sheetName, `Valores de Packing distintos de $2.83 (Inventario): ${others.length}`, others.slice(0, 20)));
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Report assembly.

function sheetFileFor(xlsxDir, wantedName) {
  const workbook = fs.readFileSync(path.join(xlsxDir, "xl/workbook.xml"), "utf8");
  const rels = fs.readFileSync(path.join(xlsxDir, "xl/_rels/workbook.xml.rels"), "utf8");
  const sheetRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g;
  let m;
  while ((m = sheetRe.exec(workbook)) !== null) {
    if (m[1] === wantedName) {
      const target = new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
        ?? new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`).exec(rels)?.[1];
      if (target) return path.join(xlsxDir, "xl", target.replace(/^\//, ""));
    }
  }
  return null;
}

function buildSummary(report, sourceHash) {
  const lines = [];
  lines.push(`# Ensayo del Excel de Fer — resumen (${new Date().toISOString().slice(0, 10)})`);
  lines.push("");
  lines.push(`Fuente: \`Ventas .xlsx\` (sha256 \`${sourceHash.slice(0, 12)}…\`). Solo lectura; el archivo no se modificó.`);
  lines.push("Nombres de clienta anonimizados (inicial + hash). Este documento sí se commitea; `report.json` completo no.");
  lines.push("");
  for (const [sheetName, issues] of Object.entries(report.sheets)) {
    lines.push(`## ${sheetName}`);
    lines.push("");
    if (!issues.length) {
      lines.push("Sin incidencias detectadas por el ensayo.");
      lines.push("");
      continue;
    }
    lines.push("| ID | Incidencia | Detalle |");
    lines.push("|---|---|---|");
    for (const i of issues) {
      const detail = String(i.detail).replace(/\|/g, "/");
      lines.push(`| ${i.id} | ${detail} | ${i.refs.length ? `refs: ${i.refs.slice(0, 6).join(", ")}${i.refs.length > 6 ? "…" : ""}` : (i.duplicates ? `${i.duplicates.length} casos` : (i.splitFactors ? Object.entries(i.splitFactors).map(([f, n]) => `${f}×${n}`).join(", ") : (i.months || i.status ? JSON.stringify(i.months ?? i.status) : "—"))) } |`);
    }
    lines.push("");
  }
  lines.push("## Interpretación (para la sesión de decisiones)");
  lines.push("");
  lines.push("- Las incidencias anteriores confirman/actualizan el análisis documental de `docs/fer-excel-analysis-2026-10-28.md` con evidencia reproducible.");
  lines.push("- Ninguna fórmula del Excel se adopta como regla sin decisión explícita (D01–D15).");
  lines.push("");
  return lines.join("\n");
}

function runReport(xlsxPath, outDir) {
  const before = crypto.createHash("sha256").update(fs.readFileSync(xlsxPath)).digest("hex");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "excel-trial-"));
  execSync(`unzip -q -o ${JSON.stringify(xlsxPath)} -d ${JSON.stringify(tmp)}`);
  const shared = parseSharedStrings(fs.readFileSync(path.join(tmp, "xl/sharedStrings.xml"), "utf8"));

  const sheets = [
    { name: "Inventario", detect: (sheet) => detectInventoryIssues(sheet) },
    {
      name: "Ventas Ago - Sep",
      detect: (sheet) =>
        detectSalesIssues(sheet, "Ventas Ago - Sep", {
          dataFrom: 3,
          dataTo: 93,
          qtyCol: "F",
          priceCol: "H",
          splitCols: ["K", "L", "M"],
          subtotalCells: [{ subtotalRef: "K28", sumFrom: 12, sumTo: 27, col: "K" }],
        }),
    },
    {
      name: "Ventas Oct",
      detect: (sheet) =>
        detectSalesIssues(sheet, "Ventas Oct", {
          dataFrom: 3,
          dataTo: 50,
          qtyCol: "F",
          priceCol: "H",
          statusCol: "P",
          packingCol: "J",
        }),
    },
  ];

  const report = { generatedAt: new Date().toISOString(), sourceSha256: before, sheets: {} };
  for (const { name, detect } of sheets) {
    const file = sheetFileFor(tmp, name);
    if (!file) {
      report.sheets[name] = [{ id: "X", sheet: name, detail: "Hoja no encontrada en el libro", refs: [] }];
      continue;
    }
    report.sheets[name] = detect(parseSheet(fs.readFileSync(file, "utf8"), shared));
  }

  const after = crypto.createHash("sha256").update(fs.readFileSync(xlsxPath)).digest("hex");
  report.sourceUnmodified = before === after;
  if (!report.sourceUnmodified) throw new Error("El archivo fuente cambió durante el ensayo — abortar.");

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  const summaryPath = path.join(outDir, "summary.md");
  fs.writeFileSync(summaryPath, buildSummary(report, before));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { report, summaryPath };
}

function main() {
  const args = process.argv.slice(2);
  const xlsxPath = args.find((a) => !a.startsWith("--"));
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : "excel-trial-out";
  if (!xlsxPath) {
    console.error("Uso: node scripts/excel-trial-report.cjs <path-to-xlsx> [--out <dir>]");
    process.exit(2);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error(`No existe: ${xlsxPath}`);
    process.exit(2);
  }
  const { report, summaryPath } = runReport(path.resolve(xlsxPath), path.resolve(outDir));
  const total = Object.values(report.sheets).reduce((n, list) => n + list.length, 0);
  console.log(`Ensayo completado: ${total} incidencias en ${Object.keys(report.sheets).length} hojas.`);
  console.log(`Fuente sin modificar: ${report.sourceUnmodified ? "sí" : "NO"}`);
  console.log(`Reporte: ${path.join(path.resolve(outDir), "report.json")}`);
  console.log(`Resumen: ${summaryPath}`);
}

if (require.main === module) main();

module.exports = {
  parseSharedStrings,
  parseSheet,
  cellAt,
  columnCells,
  colToIndex,
  normalizeName,
  anonymizeName,
  serialDateToIso,
  decodeXmlEntities,
  isErrorValue,
  detectInventoryIssues,
  detectSalesIssues,
  buildSummary,
  runReport,
};
