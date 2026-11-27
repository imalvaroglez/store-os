import { describe, expect, it } from "vitest";
import { classifyProjectionFailure, projectionProbeMarker, PROJECTION_PROBE_PREFIX } from "./projectionProbe";

// #488 r2 — the marker format is a CONTRACT between StoreProvider and the
// e2e classifier; these tests pin it so a rewording fails here, not in the
// next real flake occurrence.

describe("#488 sonda de proyección — contrato de marcas", () => {
  it("las marcas llevan prefijo, etiqueta, tipo y ts", () => {
    expect(projectionProbeMarker("start", "publicar el catálogo")).toMatch(new RegExp(`^${PROJECTION_PROBE_PREFIX}\\[publicar el catálogo\\] start ts=\\d+$`));
    expect(projectionProbeMarker("ok", "actualizar la disponibilidad pública")).toMatch(/ ok ts=\d+$/);
    expect(projectionProbeMarker("channel", "channel")).toMatch(/\[channel\] channel ts=\d+$/);
  });

  it("threw prefiere el code del SDK y nunca pierde la marca de tiempo", () => {
    const marker = projectionProbeMarker("threw", "x", { err: Object.assign(new Error("denied"), { code: "permission-denied" }) });
    expect(marker).toMatch(/ threw ts=\d+ err=code=permission-denied$/);
    const fallback = projectionProbeMarker("threw", "x", { err: new Error("boom") });
    expect(fallback).toMatch(/ threw ts=\d+ err=Error: boom$/);
  });
});

describe("#488 clasificador de fallo de proyección", () => {
  const LABEL = "actualizar la disponibilidad pública";
  const channel = () => projectionProbeMarker("channel", "channel");

  it("interrumpida: el vuelo vigilado lanzó error (con la marca completa)", () => {
    const markers = [channel(), projectionProbeMarker("start", LABEL), projectionProbeMarker("threw", LABEL, { err: Object.assign(new Error("x"), { code: "unavailable" }) })];
    expect(classifyProjectionFailure(markers, 404, 30_000, LABEL)).toMatch(/^ESCRITURA INTERRUMPIDA \[actualizar la disponibilidad pública\].*code=unavailable/);
  });

  it("escritura OK de OTRA etiqueta no engaña al clasificador (ciego a etiquetas corregido)", () => {
    const markers = [channel(), projectionProbeMarker("start", "publicar el catálogo"), projectionProbeMarker("ok", "publicar el catálogo")];
    const verdict = classifyProjectionFailure(markers, 404, 30_000, LABEL);
    expect(verdict).toContain("NUNCA SE DISPARÓ");
    expect(verdict).toContain(LABEL);
  });

  it("escritura OK de la etiqueta vigilada = fallo de lectura", () => {
    const markers = [channel(), projectionProbeMarker("start", LABEL), projectionProbeMarker("ok", LABEL)];
    expect(classifyProjectionFailure(markers, 403, 30_000, LABEL)).toContain("FALLO DE LECTURA (último status del sondeo: 403)");
  });

  it("en curso: arranque reciente sin resolución (reintento tardío)", () => {
    const markers = [channel(), `${PROJECTION_PROBE_PREFIX}[${LABEL}] start ts=${Date.now() - 5_000}`];
    expect(classifyProjectionFailure(markers, 404, 30_000, LABEL)).toMatch(/EN CURSO .*iniciada hace \d+s/);
  });

  it("atascada: arranque vencido sin resolución", () => {
    const markers = [channel(), `${PROJECTION_PROBE_PREFIX}[${LABEL}] start ts=${Date.now() - 120_000}`];
    expect(classifyProjectionFailure(markers, 404, 30_000, LABEL)).toMatch(/ATASCADA .*iniciada hace 1\d\ds/);
  });

  it("nunca se disparó SOLO con marca de canal en el documento de la escritura", () => {
    expect(classifyProjectionFailure([channel()], 404, 30_000, LABEL)).toContain("NUNCA SE DISPARÓ");
  });

  it("registro perdido sin marca de canal (latido de otra navegación no basta)", () => {
    const heartbeatFromLaterDoc = projectionProbeMarker("heartbeat", "heartbeat");
    expect(classifyProjectionFailure([heartbeatFromLaterDoc], 404, 30_000, LABEL)).toContain("REGISTRO PERDIDO");
    expect(classifyProjectionFailure([], 404, 30_000, LABEL)).toContain("REGISTRO PERDIDO");
  });

  it("un reintento reinicia el vuelo: el ok de un vuelo viejo no tapa el arranque nuevo", () => {
    const old = Date.now() - 60_000;
    const markers = [
      channel(),
      `${PROJECTION_PROBE_PREFIX}[${LABEL}] start ts=${old}`,
      `${PROJECTION_PROBE_PREFIX}[${LABEL}] ok ts=${old + 500}`,
      `${PROJECTION_PROBE_PREFIX}[${LABEL}] start ts=${Date.now() - 3_000}`,
    ];
    expect(classifyProjectionFailure(markers, 404, 30_000, LABEL)).toMatch(/EN CURSO/);
  });
});
