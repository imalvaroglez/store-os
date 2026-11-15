import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Money, Screen, ScreenHeader, TextField } from "../../design-system";
import { navigate } from "../../lib/router";
import { monthRanking, currentMonth, type RankingMonth } from "../../lib/resellerRanking";
import { useStore } from "../../app/StoreProvider";
import { loadRankingConfirmation } from "../../app/firebase/firestoreData";
import { useToast } from "../../design-system";
import type { RankingConfirmation } from "../../types";

// FER-17 (#132): top mensual de EMPRENDEDORAS — vista PRIVADA para Fer dentro
// de StoreOS. Métrica: importe neto de productos EFECTIVAMENTE entregados en
// el mes calendario CDMX (precios reales, devoluciones confirmadas
// descontadas). Participan solo clientas marcadas como emprendedoras. El
// resultado del mes en curso es PROVISIONAL; el definitivo lo confirma Fer
// tras el fin de mes — este aviso no confirma ni comunica incentivos.

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function ResellerRankingScreen() {
  const { state, activeStore } = useStore();
  const { confirmRanking } = useStore();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const month = useMemo<RankingMonth>(() => {
    const base = currentMonth();
    const zero = base.year * 12 + (base.month - 1) + offset;
    return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
  }, [offset]);
  // #132: Fer's confirmation for the VIEWED month, read on demand (no listener).
  const [confirmation, setConfirmation] = useState<RankingConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [tieMotives, setTieMotives] = useState<Record<string, string>>({});
  const [revisionMotive, setRevisionMotive] = useState("");
  useEffect(() => {
    let alive = true;
    setConfirmation(null);
    setTieMotives({});
    setRevisionMotive("");
    if (!activeStore) return;
    loadRankingConfirmation(activeStore.id, month.year, month.month)
      .then((loaded) => { if (alive) setConfirmation(loaded); })
      .catch(() => { if (alive) toast.error("No se pudo cargar la confirmación de este mes."); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- month + store identity only
  }, [activeStore?.id, month.year, month.month]);

  if (!activeStore) return null;
  const ranking = monthRanking({
    storeId: activeStore.id,
    month,
    orders: state.orders,
    customers: state.customers,
  });
  const isCurrent = offset === 0;
  // #132 (review r3): a tie AT the top-3 boundary must not be decided by the
  // alphabetical presentation order — every entry TIED with the last podium
  // slot is shown, so Fer sees the whole group she has to resolve. Ties fully
  // OUTSIDE the podium change nothing for the top and stay out of the notice.
  const base = ranking.entries.slice(0, 3);
  const boundary = base[base.length - 1];
  const podium = boundary
    ? base.concat(
        ranking.entries.slice(3).filter((entry) => entry.netCents === boundary.netCents && entry.pieces === boundary.pieces)
      )
    : base;
  const tiedInPodium = podium.length > 0
    ? podium.filter((entry) =>
        podium.some((other) => other !== entry && other.netCents === entry.netCents && other.pieces === entry.pieces)
      )
    : [];
  const tiedNames = tiedInPodium.map((entry) => entry.customerName);
  // #132: tie GROUPS (each needs Fer's motive before confirming) and the
  // month-gate — only ENDED months can be confirmed; the current one stays
  // provisional until Fer closes it.
  const tieGroups = Object.values(
    podium.reduce<Record<string, typeof podium>>((groups, entry) => {
      const key = `${entry.netCents}:${entry.pieces}`;
      const peers = podium.filter((other) => other.netCents === entry.netCents && other.pieces === entry.pieces);
      if (peers.length >= 2) groups[key] = peers;
      return groups;
    }, {})
  );
  const monthEnded = offset < 0;
  const confirmedEntries = confirmation?.entries ?? [];
  // Late-refund signal: a confirmed month whose LIVE recomputation no longer
  // matches the frozen result. History is CONSERVED; Fer decides exceptionally.
  const liveSignature = podium.map((e) => `${e.customerId}:${e.netCents}:${e.pieces}`).join("|");
  const frozenSignature = confirmedEntries.map((e) => `${e.customerId}:${e.netCents}:${e.pieces}`).join("|");
  const lateChangeConfirmed = confirmation != null && podium.length > 0 && liveSignature !== frozenSignature;

  async function runConfirm() {
    if (!activeStore) return;
    const missingMotive = tieGroups.some((group) =>
      !(tieMotives[`${group[0].netCents}:${group[0].pieces}`] ?? "").trim()
    );
    if (missingMotive) {
      toast.error("Registra el motivo de cada empate antes de confirmar el resultado.");
      return;
    }
    if (confirmation != null && lateChangeConfirmed && !revisionMotive.trim()) {
      toast.error("Una devolución cambió un mes ya confirmado: registra el motivo de tu decisión excepcional.");
      return;
    }
    setConfirmBusy(true);
    try {
      await confirmRanking({
        storeId: activeStore.id,
        year: month.year,
        month: month.month,
        entries: podium.map((entry, index) => ({
          customerId: entry.customerId,
          name: entry.customerName,
          netCents: entry.netCents,
          pieces: entry.pieces,
          rank: index + 1,
        })),
        tieResolutions: tieGroups.map((group) => ({
          customerIds: group.map((entry) => entry.customerId),
          motive: (tieMotives[`${group[0].netCents}:${group[0].pieces}`] ?? "").trim(),
        })),
        ...(confirmation != null && lateChangeConfirmed ? { revisionMotive: revisionMotive.trim() } : {}),
      });
      toast.success("Resultado confirmado. El histórico queda conservado tal como lo confirmaste.");
    } catch {
      toast.error("No se pudo confirmar el resultado. Inténtalo de nuevo.");
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Top emprendedoras"
        subtitle={`${MONTH_NAMES[month.month - 1]} ${month.year} · ${isCurrent ? "avance provisional" : "histórico"}`}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" aria-label="Mes anterior" onClick={() => setOffset((v) => v - 1)}>‹</Button>
            <Button variant="ghost" aria-label="Mes siguiente" disabled={offset >= 0} onClick={() => setOffset((v) => Math.min(0, v + 1))}>›</Button>
          </div>
        }
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-ink text-sm capitalize">{MONTH_NAMES[month.month - 1]} {month.year}</h2>
            {isCurrent && <Badge tone="warning">provisional</Badge>}
          </div>
          <p className="mt-1 text-xs text-on-surface-soft">
            Importe neto de piezas efectivamente entregadas en el mes (precios reales, devoluciones confirmadas
            descontadas). Participan solo clientas marcadas como emprendedoras. Orden: mayor importe neto; si empata,
            más piezas; si también empata, lo decides tú y queda señalado aquí.
          </p>
          {podium.length === 0 ? (
            <p className="mt-3 text-sm text-on-surface-soft">
              Sin entregas a emprendedoras este mes. Marca a una clienta como emprendedora en su ficha para que
              participe.
            </p>
          ) : confirmation != null ? (
            <>
              <ol className="mt-3 space-y-1">
                {confirmedEntries.map((entry) => (
                  <li key={entry.customerId} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">
                      {entry.rank}. {entry.name}
                    </span>
                    <span className="tnum text-right">
                      <b><Money exact amount={entry.netCents / 100} /></b>
                      <span className="text-on-surface-soft"> · {entry.pieces} {entry.pieces === 1 ? "pieza" : "piezas"}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-on-surface-soft">
                Confirmado por {confirmation.confirmedByEmail ?? confirmation.confirmedBy} el{" "}
                {new Date(confirmation.confirmedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                {confirmation.revision > 1 && " (decisión excepcional registrada)"}. El histórico se conserva tal cual.
              </p>
              {confirmation.tieResolutions.map((resolution) => (
                <p key={resolution.customerIds.join(",")} className="mt-1 text-xs text-on-surface-soft">
                  Empate resuelto — motivo: {resolution.motive}
                </p>
              ))}
              {confirmation.revisionMotive && (
                <p className="mt-1 text-xs text-on-surface-soft">
                  Decisión excepcional: {confirmation.revisionMotive}
                </p>
              )}
              {lateChangeConfirmed && (
                <div className="mt-3 rounded-lg bg-surface-muted p-3 space-y-2">
                  <p className="text-xs text-terracotta">
                    Una devolución posterior cambió los números de este mes ya confirmado. El resultado confirmado se
                    conserva; si procede un ajuste, confírmalo de nuevo registrando el motivo de tu decisión
                    excepcional.
                  </p>
                  <TextField
                    label="Motivo de la decisión excepcional"
                    value={revisionMotive}
                    onChange={(e) => setRevisionMotive(e.target.value)}
                  />
                  <Button size="sm" disabled={confirmBusy} onClick={() => void runConfirm()}>
                    {confirmBusy ? "Confirmando…" : "Volver a confirmar con el motivo"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <ol className="mt-3 space-y-1">
                {podium.map((entry, index) => (
                  <li key={entry.customerId} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink">
                      {index + 1}. {entry.customerName}
                      {entry.tie && <Badge tone="warning" className="ml-2">empate — lo resuelve Fer</Badge>}
                    </span>
                    <span className="tnum text-right">
                      <b><Money exact amount={entry.netCents / 100} /></b>
                      <span className="text-on-surface-soft"> · {entry.pieces} {entry.pieces === 1 ? "pieza" : "piezas"}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {tiedInPodium.length >= 2 && (
                <p className="mt-3 text-xs text-terracotta">
                  {tiedNames.join(" y ")} empatan con el mismo importe y las mismas piezas dentro del top: el orden
                  definitivo lo decides tú y se registra con tu motivo al confirmar.
                </p>
              )}
              {monthEnded && (
                <div className="mt-3 space-y-2">
                  {tieGroups.map((group) => {
                    const key = `${group[0].netCents}:${group[0].pieces}`;
                    return (
                      <TextField
                        key={key}
                        label={`Motivo del empate de ${group.map((entry) => entry.customerName).join(" y ")}`}
                        value={tieMotives[key] ?? ""}
                        onChange={(e) => setTieMotives((current) => ({ ...current, [key]: e.target.value }))}
                      />
                    );
                  })}
                  <Button size="sm" disabled={confirmBusy} onClick={() => void runConfirm()}>
                    {confirmBusy ? "Confirmando…" : "Confirmar resultado del mes"}
                  </Button>
                  <p className="text-xs text-on-surface-soft">
                    Confirmar congela el top tal como lo ves; los incentivos y su comunicación son tuyos.
                  </p>
                </div>
              )}
            </>
          )}
        </Card>

        {isCurrent && podium.length > 0 && (
          <p className="text-xs text-ink-soft px-1">
            Avance provisional del mes en curso; al terminar el mes, confirma el top aquí antes de comunicarlo.
          </p>
        )}
        <p className="text-xs text-ink-soft px-1">
          <Button variant="ghost" className="!px-0" onClick={() => navigate("/clientes")}>Ver clientas →</Button>
        </p>
      </div>
    </Screen>
  );
}
