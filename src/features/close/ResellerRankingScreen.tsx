import { useMemo, useState } from "react";
import { Badge, Button, Card, Money, Screen, ScreenHeader } from "../../design-system";
import { navigate } from "../../lib/router";
import { monthRanking, type RankingMonth } from "../../lib/resellerRanking";
import { useStore } from "../../app/StoreProvider";

// FER-17 (#132): top mensual de EMPRENDEDORAS — vista PRIVADA para Fer dentro
// de StoreOS. Métrica: importe neto de productos EFECTIVAMENTE entregados en
// el mes calendario CDMX (precios reales, devoluciones confirmadas
// descontadas). Participan solo clientas marcadas como emprendedoras. El
// resultado del mes en curso es PROVISIONAL; el definitivo lo confirma Fer
// tras el fin de mes — este aviso no confirma ni comunica incentivos.

/** The CURRENT CDMX calendar month. */
function currentMonth(): RankingMonth {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  return { year, month };
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function ResellerRankingScreen() {
  const { state, activeStore } = useStore();
  const [offset, setOffset] = useState(0);
  const month = useMemo<RankingMonth>(() => {
    const base = currentMonth();
    const zero = base.year * 12 + (base.month - 1) + offset;
    return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
  }, [offset]);

  if (!activeStore) return null;
  const ranking = monthRanking({
    storeId: activeStore.id,
    month,
    orders: state.orders,
    customers: state.customers,
  });
  const isCurrent = offset === 0;
  const podium = ranking.entries.slice(0, 3);

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
            descontadas). Participan solo clientas marcadas como emprendedoras.
          </p>
          {podium.length === 0 ? (
            <p className="mt-3 text-sm text-on-surface-soft">
              Sin entregas a emprendedoras este mes. Marca a una clienta como emprendedora en su ficha para que
              participe.
            </p>
          ) : (
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
          )}
          {ranking.needsManualResolution && (
            <p className="mt-3 text-xs text-terracotta">
              Hay un empate persistente (mismo importe y mismas piezas): Fer decide el orden definitivo y registra el
              motivo antes de comunicar incentivos.
            </p>
          )}
        </Card>

        {isCurrent && podium.length > 0 && (
          <Card className="!bg-terracotta-soft/60 ring-terracotta/20">
            <p className="text-sm font-semibold text-terracotta">Revisa el ranking al cierre del mes.</p>
            <p className="text-xs text-on-surface-soft">
              Este aviso no confirma el resultado ni entrega incentivos: al terminar el mes, confirma el top antes de
              comunicarlo a tus emprendedoras. Los incentivos y su comunicación son tuyos.
            </p>
          </Card>
        )}

        <p className="text-xs text-ink-soft px-1">
          Etapa FER-17 (#132): cálculo y vista privados. Si una devolución posterior cambia un resultado ya confirmado,
          el histórico se conserva y el cambio se te señala para tu decisión.
        </p>
        <p className="text-xs text-ink-soft px-1">
          <Button variant="ghost" className="!px-0" onClick={() => navigate("/clientes")}>Ver clientas →</Button>
        </p>
      </div>
    </Screen>
  );
}
