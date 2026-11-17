// #463: cross-area navigation must conserve the operator's origin. Opening a
// pedido from the products' "Comprometido" breakdown starts a counting task
// on the catalog; the pedido's back affordance has to return to THAT catalog
// (same search, filters and scroll position — restored by useListRestore),
// not to the generic orders list. Session-scoped on purpose: nothing is
// persisted (preferences-only policy) and a fresh session starts clean.

const returnOrigins = new Map<string, string>();

/** Record where a pedido was opened from, keyed by its id. */
export function setReturnOrigin(orderId: string, path: string): void {
  returnOrigins.set(orderId, path);
}

/** Consume the origin recorded for this pedido (one-shot), if any. */
export function takeReturnOrigin(orderId: string): string | undefined {
  const path = returnOrigins.get(orderId);
  returnOrigins.delete(orderId);
  return path;
}

/** Test seam: wipe the session map between cases. */
export function resetReturnOriginForTests(): void {
  returnOrigins.clear();
}
