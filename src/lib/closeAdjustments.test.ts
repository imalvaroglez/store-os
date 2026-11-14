import { describe, expect, it } from "vitest";
import {
  adjustmentTargetPeriod,
  canAuthorizeReopen,
  pendingRegularizationByRecipient,
  planAdjustment,
} from "./closeAdjustments";

// #202: correcciones posteriores al cierre. Reglas aprobadas: periodo abierto
// corrige en su periodo; origen cerrado → la diferencia REAL va al periodo
// abierto enlazada al origen; todo cerrado → PENDIENTE (nunca automática);
// reapertura excepcional SOLO la dueña (ownerUid) con dos razones documentadas;
// reparto ya pagado → diferencial por destinatario con la DISTRIBUCIÓN
// HISTÓRICA guardada, solo como pendiente de regularización. Datos
// desconocidos ≠ 0, siempre identificados.

const cents = (n: number) => Math.round(n * 100);

describe("planAdjustment (#202)", () => {
  it("periodo ABIERTO: la corrección aplica en su propio periodo con historial", () => {
    const plan = planAdjustment({
      originPeriod: { year: 2027, month: 1 },
      originClosed: false,
      openPeriods: [{ year: 2027, month: 1 }],
      differenceCents: cents(-50),
    });
    expect(plan).toMatchObject({ kind: "apply", period: { year: 2027, month: 1 }, linkedToOrigin: false });
  });

  it("origen CERRADO con periodo abierto disponible: la diferencia va al abierto, enlazada al origen", () => {
    const plan = planAdjustment({
      originPeriod: { year: 2026, month: 11 },
      originClosed: true,
      openPeriods: [{ year: 2027, month: 1 }],
      differenceCents: cents(120),
    });
    expect(plan).toMatchObject({ kind: "apply", period: { year: 2027, month: 1 }, linkedToOrigin: true });
  });

  it("el periodo de aplicación se muestra ANTES de confirmar (aplicación explícita, no automática)", () => {
    const plan = planAdjustment({
      originPeriod: { year: 2026, month: 11 },
      originClosed: true,
      openPeriods: [{ year: 2027, month: 1 }],
      differenceCents: cents(10),
      confirmed: false,
    });
    // Sin confirmación explícita, el plan queda propuesto — nunca aplicado.
    expect(plan).toMatchObject({ kind: "apply", period: { year: 2027, month: 1 }, confirmed: false });
  });

  it("TODO cerrado: la corrección queda PENDIENTE y no cambia ningún resultado", () => {
    const plan = planAdjustment({
      originPeriod: { year: 2026, month: 11 },
      originClosed: true,
      openPeriods: [],
      differenceCents: cents(300),
    });
    expect(plan.kind).toBe("pending");
    if (plan.kind === "pending") {
      expect(plan.affectsResults).toBe(false);
    }
  });

  it("diferencia de inventario y de costo de ventas identificables por separado", () => {
    const plan = planAdjustment({
      originPeriod: { year: 2026, month: 11 },
      originClosed: false,
      openPeriods: [{ year: 2026, month: 11 }],
      differenceCents: cents(-50),
      breakdown: { inventoryCents: cents(-30), costOfSalesCents: cents(-20) },
    });
    expect(plan.kind === "apply" && plan.breakdown).toEqual({ inventoryCents: cents(-30), costOfSalesCents: cents(-20) });
    // Sin desglose conocido, el dato ausente NO se trata como cero: queda
    // identificado como desconocido.
    const unknown = planAdjustment({ originPeriod: { year: 2026, month: 11 }, originClosed: false, openPeriods: [{ year: 2026, month: 11 }], differenceCents: cents(-50) });
    expect(unknown.kind === "apply" && unknown.breakdown).toBeUndefined();
  });
});

describe("adjustmentTargetPeriod (#202)", () => {
  it("periodo abierto más antiguo primero (el más cercano al origen)", () => {
    expect(adjustmentTargetPeriod([{ year: 2027, month: 3 }, { year: 2027, month: 1 }])).toEqual({ year: 2027, month: 1 });
    expect(adjustmentTargetPeriod([])).toBeNull();
  });
});

describe("canAuthorizeReopen (#202)", () => {
  const close = { storeId: "olivia", ownerUid: "fer_uid", month: { year: 2026, month: 11 }, version: 2 };
  it("SOLO la dueña autenticada (ownerUid); super-admin, miembros y SDK no", () => {
    expect(canAuthorizeReopen(close, { uid: "fer_uid" })).toBe(true);
    expect(canAuthorizeReopen(close, { uid: "super_uid", role: "super_admin" })).toBe(false);
    expect(canAuthorizeReopen(close, { uid: "member_uid" })).toBe(false);
    expect(canAuthorizeReopen(close, undefined)).toBe(false); // SDK directo sin sesión de dueña
  });
});

describe("pendingRegularizationByRecipient (#202)", () => {
  it("diferencial por destinatario con la distribución HISTÓRICA guardada — no porcentajes vigentes", () => {
    // Reparto pagado histórico: 50/30/20 sobre $1,000 con las firmas de esa
    // época. La corrección de +$200 debe repartirse con ESA distribución,
    // aunque los porcentajes vigentes hayan cambiado.
    const historical = { ferCents: cents(500), oliviaCents: cents(300), investorCents: cents(200), totalDistributedCents: cents(1000) };
    const pending = pendingRegularizationByRecipient(historical, cents(200));
    expect(pending).toEqual({ ferCents: cents(100), oliviaCents: cents(60), investorCents: cents(40) });
  });

  it("centavos exactos: el residuo va al mayor resto, nunca se pierde", () => {
    const historical = { ferCents: 5001, oliviaCents: 3000, investorCents: 2000, totalDistributedCents: 10001 };
    const pending = pendingRegularizationByRecipient(historical, 10001); // +$100.01
    expect(pending && Object.values(pending).reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it("sin reparto histórico pagado no hay regularización (no inventa cuentas)", () => {
    expect(pendingRegularizationByRecipient(null, cents(200))).toBeNull();
  });
});
