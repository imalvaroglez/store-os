// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptySnapshotFromCacheIsFailure } from "./startupOutage";

// #554 — Auth alive + Firestore unreachable resolves offline queries from an
// EMPTY cache: the app then showed «Crea tu primera tienda» (apparent
// success) instead of the explicit startup error the architecture rule
// demands. The tell is snapshot metadata: fromCache + empty.
describe("#554 arranque con Firestore inalcanzable", () => {
  it("una respuesta vacía servida de caché es un FALLO de carga, no «cero tiendas»", () => {
    expect(emptySnapshotFromCacheIsFailure({ empty: true, metadata: { fromCache: true } })).toBe(true);
  });

  it("una respuesta vacía real (servidor alcanzable) sigue siendo cero tiendas válidas", () => {
    expect(emptySnapshotFromCacheIsFailure({ empty: true, metadata: { fromCache: false } })).toBe(false);
    expect(emptySnapshotFromCacheIsFailure({ empty: true, metadata: {} })).toBe(false);
  });

  it("datos en caché (sin servidor) NO son fallo: la sesión offline legítima se conserva", () => {
    expect(emptySnapshotFromCacheIsFailure({ empty: false, metadata: { fromCache: true } })).toBe(false);
  });
});
