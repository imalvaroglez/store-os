import { describe, expect, it } from "vitest";
import { proposeDistribution } from "./profitDistribution";

// #128 — etapa lista: propuesta de reparto 50/30/20, SOLO LECTURA respecto de
// dinero. Entradas EXPLÍCITAS (resultado operativo del periodo, pérdida
// acumulada, monto propuesto): la propuesta no recalcula el cierre (#129) ni
// toca caja; sin datos de liquidez verificados lo dice, nunca los inventa.

describe("proposeDistribution (#128 etapa lista)", () => {
  it("caso de aceptación: $1,000 de utilidad, $400 propuestos → $200/$120/$80 y $600 de remanente", () => {
    const proposal = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 0,
      proposedAmountCents: 40000,
    });
    expect(proposal.baseCents).toBe(100000);
    expect(proposal.lossCompensatedCents).toBe(0);
    expect(proposal.split).toMatchObject({ ferCents: 20000, oliviaCents: 12000, investorCents: 8000 });
    expect(proposal.distributedCents).toBe(40000);
    expect(proposal.remainderCents).toBe(60000); // el remanente queda en su periodo
  });

  it("−$1,000 acumulados y +$3,000 de utilidad → base por resultados $2,000 (antes de liquidez)", () => {
    const proposal = proposeDistribution({
      operatingResultCents: 300000,
      accumulatedLossCents: 100000,
      proposedAmountCents: 300000,
    });
    expect(proposal.lossCompensatedCents).toBe(100000);
    expect(proposal.baseCents).toBe(200000);
    expect(proposal.split).toMatchObject({ ferCents: 100000, oliviaCents: 60000, investorCents: 40000 });
  });

  it("$100.01 propuestos → $50.01/$30.00/$20.00 (centavo por mayor residuo)", () => {
    const proposal = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 0,
      proposedAmountCents: 10001,
    });
    expect(proposal.split).toMatchObject({ ferCents: 5001, oliviaCents: 3000, investorCents: 2000 });
    expect(proposal.distributedCents).toBe(10001);
  });

  it("el desempate del centavo favorece Fer → Olivia → inversionista", () => {
    // 3 centavos de residuo tras los pisos: fracciones iguales para dos partes.
    // 60.03: pisos 30.01/18.01/12.01 = 6003 exacto… use 60.02: 3001/1800.6/1200.4
    // → pisos 3001/1800/1200 (=6001), sobra 1: fracciones 0/0.6/0.4 → Olivia.
    const proposal = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 0,
      proposedAmountCents: 6002,
    });
    expect(proposal.split).toMatchObject({ ferCents: 3001, oliviaCents: 1801, investorCents: 1200 });
  });

  it("pérdida operativa: nada distribuible y la pérdida se acumula", () => {
    const proposal = proposeDistribution({
      operatingResultCents: -50000,
      accumulatedLossCents: 100000,
      proposedAmountCents: 30000,
    });
    expect(proposal.baseCents).toBe(0);
    expect(proposal.distributedCents).toBe(0);
    expect(proposal.split).toMatchObject({ ferCents: 0, oliviaCents: 0, investorCents: 0 });
    expect(proposal.accumulatedLossAfterCents).toBe(150000);
  });

  it("proponer más que la base reparte solo la base (control por resultados)", () => {
    const proposal = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 40000,
      proposedAmountCents: 999999,
    });
    expect(proposal.baseCents).toBe(60000);
    expect(proposal.distributedCents).toBe(60000);
    expect(proposal.remainderCents).toBe(0);
  });

  it("sin datos de liquidez verificados queda explícito: falta la revisión (no es cero)", () => {
    const proposal = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 0,
      proposedAmountCents: 40000,
      liquidityVerifiedCents: undefined,
    });
    expect(proposal.liquidityStatus).toBe("unknown");
    // Con caja verificada por debajo del monto, la restricción se hace visible.
    const tight = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 0,
      proposedAmountCents: 40000,
      liquidityVerifiedCents: 15000,
    });
    expect(tight.liquidityStatus).toBe("insufficient");
    const ok = proposeDistribution({
      operatingResultCents: 100000,
      accumulatedLossCents: 0,
      proposedAmountCents: 40000,
      liquidityVerifiedCents: 50000,
    });
    expect(ok.liquidityStatus).toBe("verified");
  });

  it("pura e idempotente: mismas entradas, misma propuesta", () => {
    const input = { operatingResultCents: 123456, accumulatedLossCents: 10000, proposedAmountCents: 50000 };
    expect(proposeDistribution(input)).toEqual(proposeDistribution(input));
  });
});
