// Heuristic parser for supplier-order OCR text (Spanish/MX receipts).
// Pure logic, no I/O — unit-tested against the real OCR fixture (§31).
//
// Document shape (from the real WhatsApp-style receipt):
//   Recibo                       <- title (metadata, NEVER merchandise)
//   Pedido n.º 3023 - ago 19      <- order number + date
//   <product name, 1-3 lines>
//   ... 193,20 MXN                <- price closes the item
//   Dorado                        <- variant (color or ring letter)
//   x3 / 3 / ×3                   <- quantity (missing = 1)
//   ... Subtotal / Descuento / Envío / Total ...
//   Dirección de envío ... (PII — discarded)
//   Tienda \n Colore              <- supplier candidate
//
// A line item = accumulated text ending in a price, then optional variant,
// then optional quantity. The printed amount's semantics (unit vs line
// total) are NOT assumed — reconciliation decides (sourceAmountType).

const PRICE_RE = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:MXN|mxn)?\s*$/;
const QTY_RE = /^(?:[xX*×]|\(?[xX*×]\)?)\s*(\d{1,3})\)?$/;
const TOTALS_START_RE = /^(subtotal|descuento|env[íi]o|total|impuestos|incluyendo)/i;
const PII_RE = /^(direcci[óo]n|env[íi]o|facturaci[óo]n|correo|tel[ée]fono|calle|coto|c\.?p\.?|m[ée]xico|[0-9]{5}\s)/i;
const PAGE_MARKER_RE = /^(?:=== .+ ===|@@PAGE@@)$/;

// Variant tokens seen on MX jewelry receipts: colors + single ring letters.
const COLOR_VARIANTS = new Set([
  "dorado", "plateado", "bicolor", "oro", "plata", "rosa", "negro", "blanco",
  "champán", "champan", "cobre", "multicolor", "rojo", "azul", "verde",
]);

/** Parse "10.001,68" / "193,20" / "1,234.50" (either decimal separator). */
export function parseMoney(raw) {
  const m = String(raw).replace(/\s/g, "");
  const hasComma = m.includes(",");
  const hasDot = m.includes(".");
  let normalized = m;
  if (hasComma && hasDot) {
    const decSep = m.lastIndexOf(",") > m.lastIndexOf(".") ? "," : ".";
    const thouSep = decSep === "," ? "." : ",";
    normalized = m.split(thouSep).join("").replace(decSep, ".");
  } else if (hasComma) {
    normalized = m.replace(/\./g, "").replace(",", ".");
  }
  const v = parseFloat(normalized);
  return Number.isFinite(v) ? v : undefined;
}

function isVariantToken(line) {
  const t = line.toLowerCase();
  if (t.length === 1 && /[a-záéíóúñ]/.test(t)) return true; // ring letters N, R, A…
  return COLOR_VARIANTS.has(t);
}

function recordTotal(state, line) {
  const lower = line.toLowerCase();
  if (/^env[íi]o/i.test(line) && /gratis/i.test(line)) {
    if (state.shipping == null) state.shipping = 0;
    return;
  }
  // "Incluyendo 1379,55 MXN en impuestos" — the price is mid-line.
  if (/^incluyendo/i.test(line) && state.taxIncluded == null) {
    const mid = line.match(/(\d[\d.,]*[.,]\d{2})/);
    if (mid) state.taxIncluded = parseMoney(mid[1]);
    return;
  }
  const v = line.match(PRICE_RE);
  if (!v) return;
  const amount = parseMoney(v[1]);
  if (amount == null) return;
  if (/^subtotal/.test(lower) && state.subtotal == null) state.subtotal = amount;
  else if (/^total/.test(lower) && !/^totales/.test(lower) && state.total == null) state.total = amount;
  else if (/^descuento/.test(lower) && state.discount == null) state.discount = amount;
  else if (/^env[íi]o/.test(lower) && state.shipping == null) state.shipping = amount;
  else if (/incluyendo/.test(lower) && state.taxIncluded == null) state.taxIncluded = amount;
}

function parsePage(lines, state) {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || PAGE_MARKER_RE.test(line)) continue;

    // Header (only before any item): title / order number / date.
    if (state.lines.length === 0 && state.nameBuf.length === 0) {
      if (/^recibo/i.test(line)) continue; // document title, never merchandise
      const ord = line.match(/(?:pedido|order|folio|n[oó°?]?)\s*[.:nº°?]*\s*#?\s*(\d{3,10})/i);
      if (ord) state.supplierOrder = ord[1];
      const dt = line.match(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+\d{1,2}\b/i);
      if (dt) state.dateLabel = dt[0];
      if (state.supplierOrder || state.dateLabel) {
        // Metadata line — do not let it contaminate the first product's name.
        if (ord || dt) continue;
      }
    }

    // Supplier candidate: "Tienda" heading, next non-PII line is the name.
    if (state.inTotals) {
      if (/^tienda/i.test(line)) state.expectSupplier = true;
      else if (state.expectSupplier && line.length > 1 && !PII_RE.test(line)) {
        if (!state.supplierCandidate) state.supplierCandidate = line;
        state.expectSupplier = false;
      }
      recordTotal(state, line);
      continue;
    }

    if (TOTALS_START_RE.test(line)) {
      state.inTotals = true;
      state.nameBuf = []; // discard any dangling fragment; totals end items
      recordTotal(state, line);
      continue;
    }
    if (PII_RE.test(line)) continue;

    // Quantity standing alone (usually right after the variant).
    const q = line.match(QTY_RE);
    if (q && state.lines.length > 0) {
      state.lines[state.lines.length - 1].quantity = parseInt(q[1], 10);
      continue;
    }

    // A price at end-of-line closes the current item.
    const p = line.match(PRICE_RE);
    if (p) {
      const before = line.slice(0, line.indexOf(p[0])).replace(/^[\s\-_*()|>«]+/, "").replace(/[\s\-_*()|>«]+$/, "").trim();
      if (before) state.nameBuf.push(before);
      const name = state.nameBuf
        .map((frag) => frag.replace(/^[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]+/, "").replace(/[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ.,%()-]+$/, ""))
        .filter((frag) => /[a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]/.test(frag))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      state.nameBuf = [];
      const amount = parseMoney(p[1]);
      if (name && amount != null) {
        state.lines.push({ name, quantity: 1, sourceAmount: amount, variant: undefined });
      }
      continue;
    }

    // Short variant token right after a closed item → its variant.
    const last = state.lines[state.lines.length - 1];
    if (last && !last.variant && line.split(/\s+/).length === 1 && isVariantToken(line)) {
      last.variant = line;
      continue;
    }

    // Otherwise: more name text for the item being built. Skip OCR decoration
    // (lone symbols / single chars used as bullets that aren't variants).
    if (line.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ0-9]/g, "").length < 2) continue;
    state.nameBuf.push(line);
  }
}

/**
 * Decide the semantics of each line's printed amount by reconciliation:
 *   A = Σ sourceAmount            (amount is the LINE total)
 *   B = Σ sourceAmount × quantity (amount is the UNIT price)
 * compared against subtotal/total with a money tolerance.
 * Neither fits → "unknown" (the admin resolves it in review).
 */
export function reconcileAmountType(lines, reference) {
  const ref = reference ?? lines.reduce((s, l) => s + l.sourceAmount, 0);
  if (!lines.length || !ref) return "unknown";
  const A = lines.reduce((s, l) => s + l.sourceAmount, 0);
  const B = lines.reduce((s, l) => s + l.sourceAmount * l.quantity, 0);
  const tol = Math.max(0.5, ref * 0.001);
  if (Math.abs(A - ref) <= tol) return "line";
  if (Math.abs(B - ref) <= tol) return "unit";
  return "unknown";
}

/**
 * @param {string} text raw OCR text; pages separated by a `=== page ===`
 *   or `@@PAGE@@` marker (the callable inserts one per rendered page).
 * @returns {{
 *   supplierOrder?: string, dateLabel?: string, currency: string,
 *   supplierCandidate?: string,
 *   lines: {name: string, quantity: number, sourceAmount: number, variant?: string}[],
 *   subtotal?: number, discount?: number, shipping?: number,
 *   taxIncluded?: number, total?: number,
 *   sourceAmountType: "unit"|"line"|"unknown",
 *   needsReview: boolean,
 * }}
 */
export function parseSupplierOrder(text) {
  const state = {
    lines: [],
    nameBuf: [],
    inTotals: false,
    supplierOrder: undefined,
    dateLabel: undefined,
    supplierCandidate: undefined,
    subtotal: undefined, discount: undefined, shipping: undefined,
    taxIncluded: undefined, total: undefined,
  };

  // Page-aware parse with continuation stitching: nameBuf lives in the shared
  // state, so a page that ends mid-item (name without price yet) simply keeps
  // accumulating into the next page — the split item becomes ONE line.
  const pages = String(text).split(/^=== .+ ===$|@@PAGE@@$/m);
  for (const page of pages) {
    parsePage(page.split(/\r?\n/), state);
  }

  const reference = state.subtotal ?? state.total;
  const sourceAmountType = reconcileAmountType(state.lines, reference);
  const amountsKnown = sourceAmountType !== "unknown";
  const out = {
    supplierOrder: state.supplierOrder,
    dateLabel: state.dateLabel,
    currency: "MXN",
    supplierCandidate: state.supplierCandidate,
    lines: state.lines.map((l) => ({
      ...l,
      // Unit cost derived once semantics are known; left undefined otherwise
      // so nothing is invented (the review screen lets the admin set it).
      unitCost: amountsKnown
        ? sourceAmountType === "unit"
          ? l.sourceAmount
          : l.quantity > 0
            ? l.sourceAmount / l.quantity
            : l.sourceAmount
        : undefined,
    })),
    subtotal: state.subtotal,
    discount: state.discount,
    shipping: state.shipping,
    taxIncluded: state.taxIncluded,
    total: state.total,
    sourceAmountType,
    needsReview: !amountsKnown,
  };
  return out;
}
