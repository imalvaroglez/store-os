// #554 — a session that starts while Firestore is unreachable (Auth still
// alive) must show the explicit startup error, never apparent success.
//
// The Firestore SDK resolves queries offline from its (empty) cache instead
// of rejecting, so a fresh session read «0 stores» as READY and rendered
// «Crea tu primera tienda». Snapshot metadata separates the misleading case
// from the legitimate ones: fromCache + empty means "I could not reach the
// backend and have nothing cached" — a load failure.

/** True when a query answer came from an EMPTY cache: the backend was
 * unreachable AND we have no offline data — treat as a load failure. */
export function emptySnapshotFromCacheIsFailure(
  snap: Pick<QuerySnapshotLike, "empty" | "metadata">
): boolean {
  return snap.empty === true && snap.metadata?.fromCache === true;
}

/** Structural minimum of a Firestore query snapshot (test-friendly). */
export type QuerySnapshotLike = {
  empty: boolean;
  metadata?: { fromCache?: boolean };
};

/** The Spanish failure loadCloudState raises in that case — the same wording
 * Root's StartupErrorScreen already renders for cloud-load errors. */
export const STARTUP_LOAD_ERROR = "No se pudieron cargar tus tiendas. Revisa tu conexión e intenta de nuevo.";
