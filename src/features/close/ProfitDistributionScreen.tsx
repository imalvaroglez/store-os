import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Dialog, Money, Screen, ScreenHeader, SelectField, TextField } from "../../design-system";
import { parseAmount } from "../../lib/money";
import { uid } from "../../lib/ids";
import {
  accumulatedLossBefore,
  latestClosePerPeriod,
  buildProfitDistributionDoc,
  proposeDistribution,
  type ProfitDistributionDoc,
} from "../../lib/profitDistribution";
import type { CloseSnapshotDoc } from "../../lib/closeAuthorization";
import {
  authorizeProfitDistribution,
  loadClosesForStore,
  loadProfitDistributions,
} from "../../app/firebase/firestoreData";
import { useStore } from "../../app/StoreProvider";

// #459 — REPARTO DE UTILIDADES (real): sobre un periodo CERRADO (#458).
// Resumen disponible por resultados, autorización exclusiva de la dueña del
// monto que ella decida (≤ máximo), motor canónico 50/30/20 de #128 sobre lo
// AUTORIZADO, historial del periodo. La liquidez desconocida nunca se afirma
// como cero ni como efectivo disponible. La simulación pura vive aparte
// (Simulador de reparto): aquí NO hay escenarios hipotéticos ni pagos.

const cents = (text: string): number => {
  const parsed = parseAmount(text);
  return parsed == null ? 0 : Math.round(parsed * 100);
};

// #219 (Cierre/Reparto audit): a REAL money authorization never rounds a
// sub-cent fraction silently — the operator must see the rejection. Compare
// in PESOS after canonical rounding (same contract as Cobros/Compras).
const hasSubCentFraction = (text: string): boolean => {
  const parsed = parseAmount(text);
  return parsed != null && Math.abs(parsed - Math.round(parsed * 100) / 100) > 1e-9;
};

const money = (value: number) =>
  `${value < 0 ? "−" : ""}$${(Math.abs(value) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function ProfitDistributionScreen() {
  const { activeStore, draftOwnerId } = useStore();
  const [closes, setCloses] = useState<Array<CloseSnapshotDoc & { id: string }>>([]);
  const [distributions, setDistributions] = useState<Array<ProfitDistributionDoc & { id: string }>>([]);
  const [period, setPeriod] = useState<string>("");
  const [amountText, setAmountText] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // #459 r5: authorizing money is a two-step action — the button only opens
  // the review; nothing writes without the explicit «Autorizar» confirmation
  // (AGENTS: seguridad antes que velocidad).
  const [review, setReview] = useState<{ amountCents: number; split: { ferCents: number; oliviaCents: number; investorCents: number } } | null>(null);
  // #459 r6: one STABLE intent id per attempt — a retry after a lost response
  // replays it (idempotent); a NEW authorization mints a fresh one, so two
  // legitimate authorizations of the same amount never collapse.
  const intentIdRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!activeStore) return;
    loadClosesForStore(activeStore.id)
      .then((allLoaded) => {
        if (!alive) return;
        // v2 supersedes v1 (#202): the picker and the loss history see ONE
        // version per period — never double-counted.
        const latest = latestClosePerPeriod(allLoaded);
        setCloses(latest);
        setPeriod((current) => current || latest[latest.length - 1]?.period || "");
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [activeStore?.id]);

  useEffect(() => {
    let alive = true;
    if (!activeStore || !period) return;
    loadProfitDistributions(activeStore.id, period)
      .then((list) => { if (alive) setDistributions(list); })
      .catch(() => { if (alive) setDistributions([]); });
    return () => { alive = false; };
  }, [activeStore?.id, period]);

  const close = useMemo(() => closes.find((c) => c.period === period) ?? null, [closes, period]);
  const isOwner = !!activeStore?.ownerUid && activeStore.ownerUid === draftOwnerId;

  const lossBefore = useMemo(() => accumulatedLossBefore(closes, period || "~"), [closes, period]);
  const alreadyAuthorized = useMemo(
    () => distributions.reduce((sum, d) => sum + d.authorizedAmountCents, 0),
    [distributions]
  );

  const proposal = useMemo(() => {
    if (!close) return null;
    return proposeDistribution({
      operatingResultCents: close.totals.operatingResultCents ?? 0,
      accumulatedLossCents: lossBefore,
      proposedAmountCents: cents(amountText),
    });
  }, [close, lossBefore, amountText]);

  if (!activeStore) return null;

  if (loaded && closes.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Reparto de utilidades" subtitle="Sobre periodos cerrados" />
        <div className="mx-auto max-w-5xl">
          <Card>
            <p className="text-sm text-on-surface-soft">
              Todavía no hay periodos con cierre oficial. El reparto real requiere un cierre autorizado por la dueña
              (Administración → Cierre mensual); para explorar escenarios usa el Simulador de reparto.
            </p>
          </Card>
        </div>
      </Screen>
    );
  }

  const baseCents = proposal?.baseCents ?? 0;
  const maxPending = Math.max(0, baseCents - alreadyAuthorized);
  const proposalSplit = proposal?.split;

  return (
    <Screen>
      <ScreenHeader
        title="Reparto de utilidades"
        subtitle={close ? `Periodo: ${periodLabel(close.period)}` : "Cargando periodo…"}
        badge={close ? <Badge tone="success">Cerrado · v{close.version}</Badge> : undefined}
        action={
          <div className="w-56 max-w-full">
            <SelectField
              label="Periodo cerrado"
              value={period}
              onChange={(value) => { setPeriod(value); setAmountText(""); }}
              options={[...closes].reverse().map((c) => ({
                value: c.period,
                label: `${periodLabel(c.period)} · v${c.version}`,
              }))}
            />
          </div>
        }
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <h3 className="text-sm font-semibold text-ink">Resumen disponible por resultados</h3>
          <div className="mt-2 space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-on-surface-soft">Utilidad operativa del periodo</span>
              <span className="tnum">{money(close?.totals.operatingResultCents ?? 0)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-on-surface-soft">Pérdidas previas compensadas</span>
              <span className="tnum">{money(-lossBefore)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-on-surface-soft">Utilidad ya autorizada</span>
              <span className="tnum">{money(-alreadyAuthorized)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm border-t border-rule pt-1 font-semibold">
              <span className="text-ink">Máximo por resultados pendiente</span>
              <span className="tnum">{money(maxPending)}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-on-surface-soft">
            Liquidez y obligaciones: no confirmadas — este máximo NO es efectivo para retirar sin conciliación de caja (#279).
          </p>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-ink">¿Cuánto desea autorizar?</h3>
          {isOwner ? (
            <>
              <div className="mt-2 max-w-xs">
                <TextField
                  label="Importe a autorizar"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  hint={`Hasta ${money(maxPending)} por resultados`}
                />
              </div>
              {proposalSplit && cents(amountText) > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-semibold text-on-surface-soft">Distribución propuesta sobre lo autorizado</p>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">Fer 50%</span><span className="tnum">{money(proposalSplit.ferCents)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">Fondo Olivia 30%</span><span className="tnum">{money(proposalSplit.oliviaCents)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">Inversionista 20%</span><span className="tnum">{money(proposalSplit.investorCents)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm border-t border-rule pt-1">
                    <span className="text-on-surface-soft">Remanente sin autorizar</span>
                    <span className="tnum">{money(Math.max(0, maxPending - cents(amountText)))}</span>
                  </div>
                </div>
              )}
              {cents(amountText) > maxPending && !hasSubCentFraction(amountText) && (
                <p className="mt-2 text-xs text-danger">El importe supera el máximo por resultados pendiente.</p>
              )}
              {hasSubCentFraction(amountText) && (
                <p className="mt-2 text-xs text-danger">Escribe el importe en pesos con centavos (máximo dos decimales).</p>
              )}
              <Button
                className="mt-3"
                disabled={authorizing || hasSubCentFraction(amountText) || cents(amountText) <= 0 || cents(amountText) > maxPending || !close}
                onClick={() => {
                  if (!close) return;
                  const amount = cents(amountText);
                  const split = proposeDistribution({
                    operatingResultCents: close.totals.operatingResultCents ?? 0,
                    accumulatedLossCents: lossBefore,
                    proposedAmountCents: amount,
                  }).split;
                  // The intent is born WITH the review: a cancelled/failed
                  // attempt never lends its identity to a different amount
                  // later (review r6 minor 2).
                  intentIdRef.current = uid("dist");
                  setReview({ amountCents: amount, split });
                }}
              >
                Revisar y autorizar reparto
              </Button>
              {error && <p className="mt-2 text-xs text-danger">{error}</p>}

              <Dialog
                open={review !== null}
                title="Autorizar reparto"
                onClose={() => { if (!authorizing) setReview(null); }}
                footer={
                  <>
                    <Button variant="ghost" disabled={authorizing} onClick={() => setReview(null)}>Cancelar</Button>
                    <Button
                      disabled={authorizing}
                      onClick={() => {
                        if (!close || !review) return;
                        setAuthorizing(true);
                        setError(null);
                        const doc = buildProfitDistributionDoc({
                          storeId: activeStore.id, period: close.period, closeId: close.id,
                          authorizedAmountCents: review.amountCents, split: review.split,
                          uid: draftOwnerId, now: new Date().toISOString(),
                          intentId: intentIdRef.current ?? uid("dist"), // defensive: the review minted one
                        });
                        authorizeProfitDistribution(doc)
                          .then(() => loadProfitDistributions(activeStore.id, close.period))
                          .then((list) => { setDistributions(list); setAmountText(""); setReview(null); intentIdRef.current = null; })
                          .catch(() => setError("No se pudo autorizar el reparto. Revisa tu conexión; si persiste, verifica que eres la dueña de la tienda."))
                          .finally(() => setAuthorizing(false));
                      }}
                    >
                      {authorizing ? "Autorizando…" : "Autorizar"}
                    </Button>
                  </>
                }
              >
                <p className="text-sm text-on-surface-soft">
                  Se autoriza repartir <strong><Money exact amount={(review?.amountCents ?? 0) / 100} /></strong> de
                  la utilidad de {periodLabel(close?.period ?? "")} con el reparto propuesto:
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  <li className="flex items-baseline justify-between"><span>Fer 50%</span><span className="tnum"><Money exact amount={(review?.split.ferCents ?? 0) / 100} /></span></li>
                  <li className="flex items-baseline justify-between"><span>Fondo Olivia 30%</span><span className="tnum"><Money exact amount={(review?.split.oliviaCents ?? 0) / 100} /></span></li>
                  <li className="flex items-baseline justify-between"><span>Inversionista 20%</span><span className="tnum"><Money exact amount={(review?.split.investorCents ?? 0) / 100} /></span></li>
                </ul>
                <p className="mt-2 text-xs text-on-surface-soft">
                  Solo la dueña puede autorizar; la operación queda firmada a su nombre en el historial del periodo.
                </p>
              </Dialog>
            </>
          ) : (
            <p className="mt-1 text-xs text-on-surface-soft">Solo la dueña de la tienda puede autorizar un reparto.</p>
          )}
        </Card>

        {distributions.length > 0 && (
          <Card>
            <h3 className="text-sm font-semibold text-ink">Historial del periodo</h3>
            <div className="mt-2 space-y-1">
              {distributions.map((d) => (
                <div key={d.id} className="flex items-baseline justify-between text-sm border-b border-rule/60 py-1">
                  <span className="text-on-surface-soft">
                    Autorizado {d.authorizedAt.slice(0, 10)} · Fer {money(d.split.ferCents)} · Olivia {money(d.split.oliviaCents)} · Inversionista {money(d.split.investorCents)}
                  </span>
                  <span className="tnum">{money(d.authorizedAmountCents)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-on-surface-soft">
              Reservas y pagos reales se registran sobre estas autorizaciones; el histórico es inmutable.
            </p>
          </Card>
        )}
      </div>
    </Screen>
  );
}
