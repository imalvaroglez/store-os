// Heuristic parser for supplier-order OCR text (Spanish/MX receipts).
// Pure logic, no I/O — unit-tested against the real OCR fixture.
//
// Input lines look like (from the real WhatsApp-style receipt):
//   "Pedido n? 3023 - ago 19"
//   "Brazalete tubular flor"
//   "* texturizada 6.5em 193,20 MXN"     <- name tail + unit price
//   "Dorado"                              <- color (after price)
//   "x3" / "3" / "*2"                     <- quantity (after color)
//   "Subtotal 10.001,68 MXN" / "Total ..." / "Envío Gratis"
//
// Grammar assumed: a line item = accumulated text lines ending in a price
// ("NNN,NN MXN"), followed by an optional color word, then a quantity token.

const PRICE_RE = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:MXN|mxn|M[XN][XN]?)?\s*$/;
const QTY_RE = /^(?:[xX*×]|\(?[xX*×]\)?)\s*(\d{1,3})\)?$/;
const TOTALS_RE = /^(subtotal|total|descuento|env[íi]o|impuestos|incluyendo|direcci[óo]n|env[íi]o|facturaci[óo]n|correo|tienda|direcci)/i;
// Known color tokens (MX jewelry supplier). Unknown colors just stay part
// of the name — the review screen lets Fer fix anything.
const COLORS = new Set([
  "dorado", "plateado", "oro", "plata", "rosa", "negro", "blanco",
  "champán", "champan", "cobre", "multicolor", "rojo", "azul", "verde",
]);

/** Parse "10.001,68" / "193,20" / "1,234.50" (either decimal separator). */
export function parseMoney(raw) {
  const m = String(raw).replace(/\s/g, "");
  const hasComma = m.includes(",");
  const hasDot = m.includes(".");
  let normalized = m;
  if (hasComma && hasDot) {
    // Last separator is the decimal one; the other is thousands.
    const decSep = m.lastIndexOf(",") > m.lastIndexOf(".") ? "," : ".";
    const thouSep = decSep === "," ? "." : ",";
    normalized = m.split(thouSep).join("").replace(decSep, ".");
  } else if (hasComma) {
    normalized = m.replace(/\./g, "").replace(",", ".");
  }
  const v = parseFloat(normalized);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * @param {string} text raw OCR text (multi-line)
 * @returns {{
 *   supplierOrder?: string, dateLabel?: string,
 *   lines: {name: string, quantity: number, unitAmount: number}[],  // unitAmount = price shown (line total ÷ qty decided by caller)
 *   subtotal?: number, total?: number, discount?: number,
 * }}
 */
export function parseSupplierOrder(text) {
  const out = { lines: [] };
  const rawLines = String(text).split(/\r?\n/).map((l) => l.trim());

  let nameBuf = [];

  const flush = (priceStr) => {
    const name = nameBuf.join(" ").replace(/\s+/g, " ").trim();
    nameBuf = [];
    const price = parseMoney(priceStr);
    if (!name || price == null) return { name, price };
    out.lines.push({ name, quantity: 1, unitAmount: price, color: undefined });
    return { name, price };
  };

  for (const line of rawLines) {
    if (!line) continue;

    // Header: order number + date
    if (!out.supplierOrder) {
      const ord = line.match(/(?:pedido|order|folio|n[oó°?]?)\s*[.:nº°?]*\s*#?\s*(\d{3,10})/i);
      if (ord) out.supplierOrder = ord[1];
      const dt = line.match(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+\d{1,2}\b/i);
      if (dt && !out.dateLabel) out.dateLabel = dt[0];
    }

    // Totals section: stop collecting items once we hit it.
    if (TOTALS_RE.test(line)) {
      const v = line.match(PRICE_RE);
      const amount = v ? parseMoney(v[1]) : undefined;
      const lower = line.toLowerCase();
      if (lower.startsWith("subtotal") && amount != null) out.subtotal = amount;
      else if (lower.startsWith("total") && !lower.startsWith("totales") && amount != null) out.total = amount;
      else if (lower.startsWith("descuento") && amount != null) out.discount = amount;
      continue;
    }

    // Quantity token standing alone (often after the color).
    const q = line.match(QTY_RE);
    if (q && out.lines.length > 0) {
      out.lines[out.lines.length - 1].quantity = parseInt(q[1], 10);
      continue;
    }

    // A price at end-of-line closes the current item.
    const p = line.match(PRICE_RE);
    if (p) {
      const before = line.slice(0, line.indexOf(p[0])).replace(/^[\s\-_*()|>]+/, "").trim();
      if (before) nameBuf.push(before);
      flush(p[1]);
      continue;
    }

    // Short color word right after a closed item => its color.
    const last = out.lines[out.lines.length - 1];
    if (last && !last.color && line.split(/\s+/).length <= 2 && COLORS.has(line.toLowerCase())) {
      last.color = line.toLowerCase();
      continue;
    }

    // Otherwise it's more name text for the item being built.
    // Skip pure OCR decoration (single symbols, lone letters used as bullets).
    if (line.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ0-9]/g, "").length < 2) continue;
    nameBuf.push(line);
  }

  // The shown price is the LINE total in this supplier's format; the caller
  // derives unit cost = unitAmount / quantity (review screen shows both).
  return out;
}
