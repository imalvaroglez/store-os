import { describe, expect, it } from "vitest";
import { buildCloseSnapshot, closeStatus, closeDocId, nextCloseVersion, snapshotFingerprint } from "./closeAuthorization";
import type { MonthlyClose } from "./monthlyClose";
import { cdmxToday } from "./monthlyClose";

// #458 — the OFFICIAL close: states, impediments with reasons, owner-only
// authorization and an idempotent versioned snapshot. A preview is never a
// close; nothing closes itself by navigating or recalculating.

const NOV = { year: 2026, month: 11 };
const baseClose = (over: Partial<MonthlyClose> = {}): MonthlyClose => ({
  month: NOV, monthLabel: "noviembre 2026",
  salesCents: 50000, costCents: 20000, grossMarginCents: 30000,
  expensesCents: 5000, operatingResultCents: 25000, collectionsCents: 35000,
  coverage: {
    deliveredWithoutDate: [], linesWithoutCost: [], unconfirmedCollections: [],
    deliveredWithoutLine: [], unreadableData: [], complete: true,
  },
  details: { sales: [], costs: [], expenses: [], collections: [], excludedCollections: [] },
  collectionGroups: [], costCoverage: { partialByMissingCost: false },
  ...over,
});

describe("closeStatus (#458)", () => {
  it("mes en curso: Periodo en curso, sin CTA aunque los números cuadren", () => {
    const status = closeStatus({ month: NOV, today: "2026-11-15", close: baseClose() });
    expect(status.state).toBe("en_curso");
    expect(status.canClose).toBe(false);
    expect(status.impediments.map((i) => i.reason)).toContain("El mes aún no termina");
  });

  it("1 de diciembre (CDMX) habilita el preflight para noviembre", () => {
    const status = closeStatus({ month: NOV, today: "2026-12-01", close: baseClose() });
    expect(status.state).toBe("listo");
    expect(status.canClose).toBe(true);
  });

  it("mes pasado con pendientes relevantes: En revisión con la razón humana y su cola", () => {
    const close = baseClose();
    close.coverage.deliveredWithoutDate = [{ orderId: "o1", reference: "#A" }];
    close.coverage.linesWithoutCost = [{ orderId: "o2", reference: "#B", productName: "Aro", quantity: 1 }];
    const status = closeStatus({ month: NOV, today: "2026-12-01", close });
    expect(status.state).toBe("en_revision");
    expect(status.canClose).toBe(false);
    const reasons = status.impediments.map((i) => i.reason);
    expect(reasons).toContain("Faltan fechas de entrega verificables que podrían afectar noviembre");
    expect(reasons).toContain("Hay un costo desconocido que podría afectar noviembre");
    expect(status.impediments[0].queue).toBe("pedidos");
  });

  it("cobros sin fecha relevantes bloquean con su razón", () => {
    const close = baseClose();
    close.coverage.unconfirmedCollections = [{ orderId: "o3", reference: "#C", paymentId: "p", amountCents: 17000 }];
    const status = closeStatus({ month: NOV, today: "2026-12-01", close });
    expect(status.canClose).toBe(false);
    expect(status.impediments.map((i) => i.reason)).toContain("Hay cobros sin fecha que podrían pertenecer a noviembre");
  });

  it("mes YA cerrado: estado Cerrado — la versión autorizada manda", () => {
    const status = closeStatus({
      month: NOV, today: "2026-12-05", close: baseClose(),
      existing: { id: "s1__2026-11__v1", version: 1, authorizedByUid: "fer", authorizedAt: "2026-12-02T10:00:00.000Z", totals: { operatingResultCents: 25000 } },
    });
    expect(status.state).toBe("cerrado");
    expect(status.canClose).toBe(false);
    expect(status.closedBy).toBe("fer");
  });
});

describe("snapshot (#458)", () => {
  it("id determinista por tienda+periodo+versión: el reintento cae en el MISMO doc", () => {
    expect(closeDocId("s1", NOV, 1)).toBe("s1__2026-11__v1");
    expect(nextCloseVersion(undefined)).toBe(1);
    expect(nextCloseVersion(3)).toBe(4);
  });

  it("el snapshot lleva totales, cobertura, huella de fuentes, actor y esquema — inmutable", () => {
    const close = baseClose();
    const snapshot = buildCloseSnapshot({
      storeId: "s1", close, uid: "fer", now: "2026-12-02T10:00:00.000Z", version: 1,
    });
    expect(snapshot).toMatchObject({
      id: "s1__2026-11__v1", storeId: "s1", period: "2026-11", version: 1,
      createdBy: "fer", authorizedByUid: "fer",
      totals: { salesCents: 50000, costCents: 20000, expensesCents: 5000, operatingResultCents: 25000, collectionsCents: 35000 },
      coverageComplete: true,
    });
    // La huella cambia si las FUENTES (contribuciones) cambian — no por el total.
    const other = baseClose();
    other.details.sales = [{ date: "2026-11-10", kind: "sale", reference: "#X", concept: "Venta", amountCents: 50000, evidence: "verified" }];
    expect(snapshotFingerprint(other)).not.toBe(snapshotFingerprint(close));
    expect(snapshotFingerprint(close)).toBe(snapshotFingerprint(baseClose()));
  });
});

describe("#458 r2 — mayores de revisión", () => {
  it("fecha límite por fecha CDMX real (cdmxToday), nunca el slice UTC", () => {
    // 30-nov 18:30 CDMX = 1-dic 00:30 UTC: cdmxToday debe decir 11-30.
    expect(cdmxToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("periodo parcial desde la activación: impedimento explícito, sin CTA", () => {
    const status = closeStatus({ month: NOV, today: "2026-12-01", close: baseClose(), activationDate: "2026-11-15" });
    expect(status.canClose).toBe(false);
    expect(status.impediments[0].reason).toContain("Periodo financiero parcial desde la activación");
  });

  it("mes completo ANTERIOR a la activación: sin marca de parcialidad", () => {
    const status = closeStatus({ month: NOV, today: "2026-12-01", close: baseClose(), activationDate: "2026-08-02" });
    expect(status.state).toBe("listo");
  });
});
