import { describe, it, expect } from "vitest";
import { simulateContribution } from "./contribution";

// #336: deterministic contribution/break-even algebra — exact cents, visible
// assumptions, hard restrictions, never a fabricated forecast.

const base = {
  priceCurrentCents: 5430,
  priceProposedCents: 6000,
  basePieces: 10,
  volumeSource: "ingresado" as const,
  variableCostCents: 5000, // c0 = 430, c1 = 1000
  perOrderPackagingCents: 1500,
  minContributionPerPieceCents: null,
  ladder: null,
  sensitivityPct: [],
};

describe("simulateContribution — happy path y equilibrio", () => {
  it("calcula contribución unitaria/total y q* fraccional con referencia y piezas enteras (ejemplo 4.3)", () => {
    const result = simulateContribution(base);
    expect(result.status).toBe("ok");
    expect(result.unitCurrentCents).toBe(430);
    expect(result.unitProposedCents).toBe(1000);
    expect(result.baseTotalCents).toBe(4300);
    expect(result.scenarioTotalCents).toBe(10000);
    expect(result.deltaCents).toBe(5700);
    expect(result.breakEven).not.toBeNull();
    expect(result.breakEven!.label).toBe("4.3");
    expect(result.breakEven!.piecesToMatch).toBe(5); // igualar/superar
    expect(result.breakEven!.piecesToExceed).toBe(5); // 4.3 no es entero → el techo ya supera
  });

  it("q* entero distingue igualar de superar estrictamente", () => {
    const result = simulateContribution({ ...base, priceCurrentCents: 6000, priceProposedCents: 5500 });
    // c0 = 1000, c1 = 500 → q* = 10 × 1000/500 = 20 exacto.
    expect(result.breakEven!.label).toBe("20");
    expect(result.breakEven!.piecesToMatch).toBe(20);
    expect(result.breakEven!.piecesToExceed).toBe(21);
  });

  it("la fracción se reduce y el decimal de referencia es exacto hasta una cifra", () => {
    const result = simulateContribution({ ...base, basePieces: 7 }); // 7×430/1000 = 3.01
    expect(result.breakEven!.label).toBe("3.01");
    expect(result.breakEven!.exact).toEqual({ numerator: 301, denominator: 100 });
    expect(result.breakEven!.piecesToMatch).toBe(4);
  });

  it("sensibilidad con cambios de volumen indicados: piezas enteras y totales exactos, etiquetados como escenario", () => {
    const result = simulateContribution({ ...base, sensitivityPct: [-20, 10] });
    expect(result.sensitivity).toEqual([
      { pct: -20, pieces: 8, totalCents: 8000 },
      { pct: 10, pieces: 11, totalCents: 11000 },
    ]);
    expect(result.notes.join(" ")).toMatch(/escenario, no pronóstico/i);
  });
});

describe("simulateContribution — límites explicables", () => {
  it("contribución propuesta cero o negativa: ningún volumen alcanza, sin infinito ni q*", () => {
    const zero = simulateContribution({ ...base, priceProposedCents: 5000 });
    expect(zero.status).toBe("limit");
    expect(zero.breakEven).toBeNull();
    expect(zero.notes.join(" ")).toMatch(/ningún volumen alcanza/i);
    const negative = simulateContribution({ ...base, priceProposedCents: 4000 });
    expect(negative.status).toBe("limit");
    expect(negative.breakEven).toBeNull();
    expect(JSON.stringify(negative)).not.toMatch(/Infinity|NaN/);
  });

  it("volumen base cero: límite explicable sin cifras de equilibrio", () => {
    const result = simulateContribution({ ...base, basePieces: 0 });
    expect(result.status).toBe("limit");
    expect(result.breakEven).toBeNull();
    expect(result.scenarioTotalCents).toBe(0);
    expect(result.notes.join(" ")).toMatch(/volumen base es cero/i);
  });

  it("contribución base cero o negativa con propuesta positiva: cualquier volumen iguala o supera", () => {
    const result = simulateContribution({ ...base, priceCurrentCents: 5000 }); // c0 = 0
    expect(result.status).toBe("ok");
    expect(result.breakEven!.label).toBe("0");
    expect(result.breakEven!.piecesToMatch).toBe(0);
    expect(result.breakEven!.piecesToExceed).toBe(1);
    expect(result.notes.join(" ")).toMatch(/contribución actual por pieza es cero/i);
  });

  it("costo desconocido: nada se calcula como si fuera cero; se nombra lo que falta", () => {
    const result = simulateContribution({ ...base, variableCostCents: null });
    expect(result.status).toBe("limit");
    expect(result.unitCurrentCents).toBeNull();
    expect(result.scenarioTotalCents).toBeNull();
    expect(result.notes.join(" ")).toMatch(/costo desconocido/i);
  });

  it("empaque por pedido va aparte: nunca entra al costo unitario ni se divide entre piezas", () => {
    const result = simulateContribution(base);
    expect(result.unitProposedCents).toBe(1000); // sin el perOrder
    expect(result.perOrderPackagingCents).toBe(1500);
    expect(result.notes.join(" ")).toMatch(/aparte, por pedido/i);
  });
});

describe("simulateContribution — restricciones duras", () => {
  const ladder = [
    { label: "Regular", priceCents: 30000 },
    { label: "Girly", priceCents: 36000 },
    { label: "Iconic", priceCents: 42000 },
  ];

  it("un precio propuesto que rompe la escalera comercial es infactible y nombra la restricción", () => {
    // Simulando Girly (índice 1) por debajo de Regular.
    const result = simulateContribution({
      ...base, priceProposedCents: 29000, ladder, simulatedTierIndex: 1,
    });
    expect(result.status).toBe("infeasible");
    expect(result.blockers.join(" ")).toMatch(/escalera/i);
    expect(result.blockers.join(" ")).toMatch(/Regular/);
    expect(result.scenarioTotalCents).toBeNull();
  });

  it("romper por arriba también es infactible", () => {
    const result = simulateContribution({
      ...base, priceProposedCents: 45000, ladder, simulatedTierIndex: 1,
    });
    expect(result.status).toBe("infeasible");
    expect(result.blockers.join(" ")).toMatch(/Iconic/);
  });

  it("un precio dentro de la escalera pasa", () => {
    const result = simulateContribution({
      ...base, priceCurrentCents: 35000, priceProposedCents: 37000,
      variableCostCents: 20000, ladder, simulatedTierIndex: 1,
    });
    expect(result.status).toBe("ok");
  });

  it("el mínimo de contribución por pieza que Fer ingresa es restricción dura", () => {
    const result = simulateContribution({ ...base, minContributionPerPieceCents: 1200 });
    expect(result.status).toBe("infeasible");
    expect(result.blockers.join(" ")).toMatch(/mínimo de contribución/i);
    // El mínimo no debe dispararse cuando la propuesta lo cumple.
    const okResult = simulateContribution({ ...base, minContributionPerPieceCents: 900 });
    expect(okResult.status).toBe("ok");
  });

  it("sin mínimo ingresado no hay resultado que dependa de él", () => {
    const result = simulateContribution(base);
    expect(result.blockers).toHaveLength(0);
    expect(JSON.stringify(result)).not.toMatch(/mínimo/i);
  });
});

describe("simulateContribution — sin sorpresas numéricas", () => {
  it("jamás produce NaN o Infinity en ninguna salida", () => {
    const cases = [
      base,
      { ...base, basePieces: 0 },
      { ...base, variableCostCents: null },
      { ...base, priceProposedCents: 1 },
      { ...base, sensitivityPct: [-100, 0, 250] },
    ];
    for (const input of cases) {
      expect(JSON.stringify(simulateContribution(input))).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("nota de límite precisa con contribuciones no positivas (#336 QA menor)", () => {
  it("c0 ≤ 0 y c1 = 0: cualquier volumen iguala o supera (no «ningún volumen alcanza»)", () => {
    const result = simulateContribution({
      priceCurrentCents: 1000, priceProposedCents: 1000,
      basePieces: 5, volumeSource: "ingresado",
      variableCostCents: 1000, // c0 = c1 = 0
      minContributionPerPieceCents: null, ladder: null, simulatedTierIndex: undefined, sensitivityPct: [],
    });
    expect(result.status).toBe("limit");
    expect(result.notes.some((note) => note.includes("cualquier volumen iguala o supera"))).toBe(true);
    expect(result.notes.some((note) => note.includes("ningún volumen alcanza"))).toBe(false);
  });

  it("c0 > 0 y c1 = 0: aquí sí ningún volumen alcanza", () => {
    const result = simulateContribution({
      priceCurrentCents: 1500, priceProposedCents: 1000,
      basePieces: 5, volumeSource: "ingresado",
      variableCostCents: 1000, // c0 = 500, c1 = 0
      minContributionPerPieceCents: null, ladder: null, simulatedTierIndex: undefined, sensitivityPct: [],
    });
    expect(result.status).toBe("limit");
    expect(result.notes.some((note) => note.includes("ningún volumen alcanza"))).toBe(true);
  });
});
