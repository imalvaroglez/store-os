// #211 fase 1: remember the CONFIRMED association between a supplier's exact
// ticket code and a product — identity is storeId + supplierId + normalized
// code (the ORIGINAL captured text always travels on the purchase line).
// Normalization exists ONLY for matching; it never rewrites history.

export type SupplierProductLink = {
  id: string; // linkDocId
  storeId: string;
  supplierId: string;
  /** Original captured code, exactly as printed on the ticket. */
  code: string;
  /** Matching key (normalized); collisions surface for review, never guess. */
  normalizedCode: string;
  productId: string;
  productName: string;
  confirmedAt: string;
  confirmedBy: string;
};

/**
 * Normalize a ticket code for MATCHING only: trim, lowercase, drop spaces,
 * dashes and dots; map the classic ticket-print confusions O→0 and I→1.
 * B/V stay DISTINCT (Spanish supplier codes carry both on purpose).
 */
export function normalizeSupplierCode(code: string): string {
  return code
    .trim()
    .toLocaleLowerCase("es-MX")
    .replace(/[\s\-.]/g, "")
    .replace(/o/g, "0")
    .replace(/i/g, "1");
}

/** Stable doc id: the association belongs to ONE store + ONE supplier + code. */
export function linkDocId(storeId: string, supplierId: string, code: string): string {
  return `${storeId}__${supplierId}__${normalizeSupplierCode(code)}`;
}

export type LinkSuggestion = { productId: string; productName: string };

/**
 * The product to SUGGEST for a captured code — only when the operator
 * previously CONFIRMED exactly ONE association for this store+supplier+code.
 * No association, another store/supplier, an unidentified supplier or
 * CONTRADICTORY associations return null (review, never a guess).
 */
export function suggestedProductFor(
  links: ReadonlyArray<SupplierProductLink>,
  storeId: string,
  supplierId: string | undefined,
  code: string
): LinkSuggestion | null {
  if (!supplierId) return null; // unidentified supplier: nothing to consult
  const key = normalizeSupplierCode(code);
  if (!key) return null;
  const matches = links.filter(
    (link) => link.storeId === storeId && link.supplierId === supplierId && link.normalizedCode === key
  );
  const unique = new Set(matches.map((link) => link.productId));
  if (unique.size !== 1) return null; // absent or contradictory → review
  const match = matches[0];
  return { productId: match.productId, productName: match.productName };
}
