import { useMemo, useState } from "react";
import { Button, Card, Screen, ScreenHeader, TextField } from "../../design-system";
import { parseAmount } from "../../lib/money";
import { proposeDistribution } from "../../lib/profitDistribution";

// #459 — SIMULADOR de reparto: explorar montos hipotéticos con el motor
// canónico de #128 (50/30/20, mayor residuo, pérdidas primero). SOLO LECTURA:
// no escribe dinero ni estado, no comparte controles de autorización, y lo
// declara siempre. La autorización real vive en Reparto de utilidades.

const cents = (text: string): number => {
  const parsed = parseAmount(text);
  return parsed == null ? 0 : Math.round(parsed * 100);
};

export function ProfitSimulatorScreen() {
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

  const money = (value: number) => `$${(value / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Screen>
      <ScreenHeader
        title="Simulador de reparto"
        subtitle="Simulación, sin efectos — no autoriza ni realiza pagos"
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <TextField
              label="Resultado del periodo"
              inputMode="decimal"
              value={resultText}
              onChange={(event) => setResultText(event.target.value)}
              hint="Hipotético; no se lee de ningún cierre"
            />
            <TextField
              label="Pérdida acumulada"
              inputMode="decimal"
              value={lossText}
              onChange={(event) => setLossText(event.target.value)}
            />
            <TextField
              label="Monto hipotético a repartir"
              inputMode="decimal"
              value={proposedText}
              onChange={(event) => setProposedText(event.target.value)}
            />
          </div>
        </Card>

        <Card>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-on-surface-soft">Base estimada tras pérdidas</span>
              <span className="tnum text-ink">{money(proposal.baseCents)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm border-t border-rule pt-1">
              <span className="text-ink">Fer 50%</span>
              <span className="tnum text-ink">{money(proposal.split.ferCents)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink">Fondo Olivia 30%</span>
              <span className="tnum text-ink">{money(proposal.split.oliviaCents)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink">Inversionista 20%</span>
              <span className="tnum text-ink">{money(proposal.split.investorCents)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm border-t border-rule pt-1">
              <span className="text-on-surface-soft">Remanente en el periodo</span>
              <span className="tnum text-ink">{money(proposal.remainderCents)}</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-on-surface-soft">Simulación, sin efectos · No autoriza ni realiza pagos.</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setResultText("");
                setLossText("");
                setProposedText("");
              }}
            >
              Restablecer
            </Button>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
