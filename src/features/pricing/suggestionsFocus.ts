// #289: context handoff between the pricing screens. Estrategia saves a
// category table and points Fer at Reglas; Reglas then opens with that
// category pre-filtered instead of an unfiltered 283-SKU list.
// ponytail: a module-level one-shot instead of routing changes — the admin
// router matches at most two segments, and a query string would not survive
// matchRoute. Consumed once on mount; a refresh simply starts unfiltered.
let pendingFocus: string | null = null;

/** Remember the category the operator just configured ("" clears it). */
export function setSuggestionsFocus(categoryId: string): void {
  pendingFocus = categoryId;
}

/** Take (and clear) the pending focus, if any. */
export function takeSuggestionsFocus(): string | null {
  const value = pendingFocus;
  pendingFocus = null;
  return value;
}
