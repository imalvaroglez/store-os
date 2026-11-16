import { useMemo, useState } from "react";
import { Badge, Button, Card, Money, Screen, ScreenHeader, TextField } from "../../design-system";
import { navigate } from "../../lib/router";
import { parseAmount } from "../../lib/money";
import { proposeDistribution } from "../../lib/profitDistribution";

// #128 — etapa lista: vista del REPARTO PROPUESTO, una simulación de solo
// lectura. Entradas explícitas (resultado del periodo, pérdida acumulada,
// monto propuesto); no recalcula el cierre (#129), no autoriza, no mueve
// fondos. Sin caja y obligaciones verificadas (#279) dice que falta la
// revisión de liquidez — lo desconocido nunca se trata como cero.

const cents = (text: string): number => {
  const parsed = parseAmount(text);
  return parsed == null ? 0 : Math.round(parsed * 100);
};

export function ProfitDistributionScreen() {
  const [resultText, setResultText] = useState("");
  const [lossText, setLossText] = useState("");
  const [proposedText, setProposedText] = useState("");

  const proposal = useMemo(
    () =>
      proposeDistribution({
        operatingResultCents: cents(resultText),
        accumulatedLossCents: cents(lossText),
        proposedAmountCents: cents(proposedText),
      }),
    [resultText, lossText, proposedText]
  );
  const started = resultText.trim() !== "" || lossText.trim() !== "" || proposedText.trim() !== "";

  return (
    <Screen>
      <ScreenHeader
        title="Reparto propuesto"
        subtitle="Simulación 50/30/20 · solo lectura"
        action={<Button variant="ghost" onClick={() => navigate("/productos/gastos")}>← Gastos</Button>}
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-ink text-sm">Simulación del reparto</h2>
            <Badge tone="warning">Simulación</Badge>
          </div>
          <p className="mt-1 text-xs text-on-surface-soft">
            Captura el resultado operativo del periodo y lo que se propone repartir. Esto no autoriza repartos ni
            mueve dinero: la autorización queda para la etapa operativa, con la validación de Fer del primer cierre.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <TextField
              label="Resultado operativo del periodo"
              inputMode="decimal"
              placeholder="1000.00"
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
            />
            <TextField
              label="Pérdida acumulada anterior"
              inputMode="decimal"
              placeholder="0.00"
              value={lossText}
              onChange={(e) => setLossText(e.target.value)}
            />
            <TextField
              label="Monto propuesto a repartir"
              inputMode="decimal"
              placeholder="400.00"
              value={proposedText}
              onChange={(e) => setProposedText(e.target.value)}
            />
          </div>
        </Card>

        {started && (
          <Card>
            <h3 className="font-semibold text-ink text-sm">Propuesta</h3>
            <div className="mt-2 space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-on-surface-soft">Base por resultados (tras compensar pérdidas)</span>
                <b className="tnum"><Money exact amount={proposal.baseCents / 100} /></b>
              </div>
              {proposal.lossCompensatedCents > 0 && (
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-on-surface-soft">Pérdida acumulada compensada este periodo</span>
                  <b className="tnum"><Money exact amount={proposal.lossCompensatedCents / 100} /></b>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-on-surface-soft">A repartir ahora</span>
                <b className="tnum"><Money exact amount={proposal.distributedCents / 100} /></b>
              </div>
              <div className="rule my-2" />
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">Fer (50%)</span>
                <b className="tnum"><Money exact amount={proposal.split.ferCents / 100} /></b>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">Olivia (30%)</span>
                <b className="tnum"><Money exact amount={proposal.split.oliviaCents / 100} /></b>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">Inversionista (20%)</span>
                <b className="tnum"><Money exact amount={proposal.split.investorCents / 100} /></b>
              </div>
              <div className="rule my-2" />
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-on-surface-soft">Remanente (queda en su periodo)</span>
                <b className="tnum"><Money exact amount={proposal.remainderCents / 100} /></b>
              </div>
              {proposal.accumulatedLossAfterCents > 0 && (
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-on-surface-soft">Pérdida acumulada tras el periodo</span>
                  <b className="tnum"><Money exact amount={proposal.accumulatedLossAfterCents / 100} /></b>
                </div>
              )}
            </div>
            {proposal.liquidityStatus !== "verified" && (
              <p className="mt-3 text-xs text-terracotta">
                {proposal.liquidityStatus === "unknown"
                  ? "Falta la revisión de liquidez: sin caja y obligaciones verificadas esto es solo una simulación (la fuente llega con el panel financiero)."
                  : "La caja verificada no cubre el monto propuesto: revisa la liquidez antes de autorizar."}
              </p>
            )}
          </Card>
        )}

        <p className="text-xs text-ink-soft px-1">
          Etapa «reparto propuesto» de #128: cálculo y vista de solo lectura. La autorización, las reservas y el
          registro de pagos reales quedan para la etapa operativa.
        </p>
      </div>
    </Screen>
  );
}
