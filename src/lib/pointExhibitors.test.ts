import { describe, expect, it } from "vitest";
import type { PointExhibitor } from "../types";
import {
  exhibitorDeliveryImpediments,
  exhibitorSummary,
  groupExhibitorsByLine,
  pickWithdrawalPieces,
} from "./pointExhibitors";

// #524 — pestaña Exhibidores: entregas por renglón, costo de apertura vs
// costo asignado, retiros con historial e importes pendientes de confirmar.
// Dinero en centavos exactos; un costo que falta nunca es cero.

const TODAY = "2026-11-25";

function piece(overrides: Partial<PointExhibitor> = {}): PointExhibitor {
  return {
    id: "pex_i1_0",
    storeId: "s1",
    pointId: "pt1",
    deliveryId: "i1",
    lineIndex: 0,
    name: "Tabla plegable",
    deliveredAt: "2026-11-01",
    opening: true,
    deliveredBy: "u1",
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

/** The PO mission: apertura 2 tablas de $104 + $58 + $72 = $338. */
function openingMission(): PointExhibitor[] {
  return [
    piece({ id: "pex_a_0", deliveryId: "a", name: "Tabla", unitCostCents: 10400 }),
    piece({ id: "pex_a_1", deliveryId: "a", name: "Tabla", unitCostCents: 10400 }),
    piece({ id: "pex_a_2", deliveryId: "a", lineIndex: 1, name: "Exhibidor chico", unitCostCents: 5800 }),
    piece({ id: "pex_a_3", deliveryId: "a", lineIndex: 2, name: "Exhibidor grande", unitCostCents: 7200 }),
  ];
}

describe("exhibitorDeliveryImpediments — plan de la entrega", () => {
  it("acepta renglones con nombre, piezas y costo opcional en fecha real", () => {
    const check = exhibitorDeliveryImpediments(
      [
        { name: "Tabla", quantity: 2, unitCostCents: 10400 },
        { name: "Exhibidor", quantity: 1 },
      ],
      "2026-11-20",
      { today: TODAY }
    );
    expect(check.canDeliver).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it("rechaza fecha inválida, futura o previa al año 2000", () => {
    for (const date of ["2026-02-30", "20-11-2026", "2026-11-26", "1999-12-31"]) {
      const check = exhibitorDeliveryImpediments([{ name: "Tabla", quantity: 1 }], date, { today: TODAY });
      expect(check.canDeliver).toBe(false);
      expect(check.errors).toHaveLength(1);
    }
  });

  it("exige al menos un renglón", () => {
    const check = exhibitorDeliveryImpediments([], "2026-11-20", { today: TODAY });
    expect(check.canDeliver).toBe(false);
    expect(check.errors.join(" ")).toContain("al menos un exhibidor");
  });

  it("rechaza nombre vacío, piezas no enteras y costo no positivo", () => {
    const check = exhibitorDeliveryImpediments(
      [
        { name: "   ", quantity: 1 },
        { name: "Tabla", quantity: 0 },
        { name: "Cubo", quantity: 1.5 },
        { name: "Vitrina", quantity: 1, unitCostCents: 0 },
        { name: "Barral", quantity: 1, unitCostCents: -100 },
      ],
      "2026-11-20",
      { today: TODAY }
    );
    expect(check.canDeliver).toBe(false);
    expect(check.errors.join(" ")).toContain("nombre");
    expect(check.errors.join(" ")).toContain("piezas");
    expect(check.errors.filter((e) => e.includes("costo"))).toHaveLength(2);
  });
});

describe("exhibitorSummary — costo de apertura y costo asignado", () => {
  it("misión: apertura y asignado en $338 con los cuatro exhibidores", () => {
    const summary = exhibitorSummary(openingMission());
    expect(summary).toEqual({
      openingCostCents: 33800,
      openingPendingUnits: 0,
      assignedCostCents: 33800,
      assignedPendingUnits: 0,
    });
  });

  it("una entrega posterior suma al asignado y no a la apertura", () => {
    const later = piece({
      id: "pex_b_0",
      deliveryId: "b",
      lineIndex: 0,
      name: "Exhibidor mediano",
      deliveredAt: "2026-11-15",
      opening: false,
      unitCostCents: 9000,
    });
    const summary = exhibitorSummary([...openingMission(), later]);
    expect(summary.openingCostCents).toBe(33800);
    expect(summary.assignedCostCents).toBe(42800);
  });

  it("retirar una tabla deja la apertura en $338 y el asignado en $324", () => {
    const later = piece({
      id: "pex_b_0",
      deliveryId: "b",
      lineIndex: 0,
      name: "Exhibidor mediano",
      deliveredAt: "2026-11-15",
      opening: false,
      unitCostCents: 9000,
    });
    const pieces = [...openingMission(), later];
    pieces[0] = { ...pieces[0], withdrawnAt: "2026-11-20", withdrawnBy: "u2" };
    const summary = exhibitorSummary(pieces);
    expect(summary.openingCostCents).toBe(33800);
    expect(summary.assignedCostCents).toBe(32400);
  });

  it("un costo pendiente cuenta piezas sin valorar y no suma importe", () => {
    const summary = exhibitorSummary([
      ...openingMission(),
      piece({ id: "pex_c_0", deliveryId: "c", name: "Barral", opening: false, deliveredAt: "2026-11-18" }),
    ]);
    expect(summary.openingCostCents).toBe(33800);
    expect(summary.assignedCostCents).toBe(33800);
    expect(summary.assignedPendingUnits).toBe(1);
    expect(summary.openingPendingUnits).toBe(0);
  });

  it("una pieza de apertura sin valorar cuenta como pendiente de apertura", () => {
    const summary = exhibitorSummary([
      piece({ id: "pex_d_0", deliveryId: "d", name: "Tabla" }),
      piece({ id: "pex_d_1", deliveryId: "d", name: "Tabla" }),
    ]);
    expect(summary.openingCostCents).toBe(0);
    expect(summary.openingPendingUnits).toBe(2);
    expect(summary.assignedPendingUnits).toBe(2);
  });

  it("una pieza retirada sin costo deja de pedir valoración", () => {
    const summary = exhibitorSummary([
      piece({ withdrawnAt: "2026-11-20", withdrawnBy: "u2" }),
    ]);
    expect(summary).toEqual({
      openingCostCents: 0,
      openingPendingUnits: 0,
      assignedCostCents: 0,
      assignedPendingUnits: 0,
    });
  });
});

describe("groupExhibitorsByLine — renglones de la interfaz", () => {
  it("agrupa por entrega y renglón, sin mezclar entregas del mismo nombre", () => {
    const groups = groupExhibitorsByLine([
      ...openingMission(),
      piece({ id: "pex_b_0", deliveryId: "b", name: "Tabla", deliveredAt: "2026-11-15", opening: false, unitCostCents: 9000 }),
    ]);
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => [g.deliveryId, g.lineIndex])).toEqual([
      ["a", 0],
      ["a", 1],
      ["a", 2],
      ["b", 0],
    ]);
    expect(groups[0].pieces.map((p) => p.id)).toEqual(["pex_a_0", "pex_a_1"]);
    expect(groups[3].name).toBe("Tabla");
  });

  it("ordena los renglones por fecha de entrega ascendente", () => {
    const groups = groupExhibitorsByLine([
      piece({ id: "pex_b_0", deliveryId: "b", deliveredAt: "2026-11-15", name: "Tarde" }),
      piece({ id: "pex_a_0", deliveryId: "a", deliveredAt: "2026-11-01", name: "Temprano" }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Temprano", "Tarde"]);
  });

  it("ordena las piezas del renglón por antigüedad", () => {
    const groups = groupExhibitorsByLine([
      piece({ id: "pex_a_1", createdAt: "2026-11-01T13:00:00.000Z" }),
      piece({ id: "pex_a_0", createdAt: "2026-11-01T12:00:00.000Z" }),
    ]);
    expect(groups[0].pieces.map((p) => p.id)).toEqual(["pex_a_0", "pex_a_1"]);
  });
});

describe("pickWithdrawalPieces — qué piezas salen en un retiro", () => {
  it("toma las más antiguas primero y solo del renglón pedido", () => {
    const pieces: PointExhibitor[] = [
      piece({ id: "new_0", deliveryId: "b", deliveredAt: "2026-11-15", unitCostCents: 9000 }),
      piece({ id: "old_1", deliveryId: "a", createdAt: "2026-11-01T13:00:00.000Z" }),
      piece({ id: "old_0", deliveryId: "a", createdAt: "2026-11-01T12:00:00.000Z" }),
    ];
    const pick = pickWithdrawalPieces(pieces, { deliveryId: "a", lineIndex: 0, quantity: 1 });
    expect(pick.ids).toEqual(["old_0"]);
    expect(pick.shortUnits).toBe(0);
  });

  it("reporta faltantes cuando pide más piezas de las asignadas", () => {
    const pick = pickWithdrawalPieces(openingMission(), { deliveryId: "a", lineIndex: 0, quantity: 3 });
    expect(pick.ids).toEqual(["pex_a_0", "pex_a_1"]);
    expect(pick.shortUnits).toBe(1);
  });

  it("ignora las piezas ya retiradas", () => {
    const pieces = openingMission();
    pieces[0] = { ...pieces[0], withdrawnAt: "2026-11-20" };
    const pick = pickWithdrawalPieces(pieces, { deliveryId: "a", lineIndex: 0, quantity: 2 });
    expect(pick.ids).toEqual(["pex_a_1"]);
    expect(pick.shortUnits).toBe(1);
  });
});
