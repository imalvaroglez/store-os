import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { purchasesForStore } from "../../lib/selectors";
import { saleExpenseCategoryRows, saleExpensePeriodTotals } from "../../lib/saleExpenses";
import { formatMoneyExact } from "../../lib/money";
import { Card, IconButton } from "../../design-system";

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function shiftMonth(year: number, month: number, delta: number) {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12 + 12) % 12 + 1 };
}

/**
 * Gastos de venta del periodo (#184, executable slice): read-only visibility of
 * what it costs to SELL — delivery to the client and packaging — grouped by
 * month and category, over purchases already loaded for the active store
 * (no new reads). Registering standalone expenses waits for the PO decision on
 * how their estimated cost is assigned; this view only shows what exists.
 */
export function SaleExpenseSummary() {
  const { state, activeStore } = useStore();
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const purchases = useMemo(
    () => (activeStore ? purchasesForStore(state.purchases, activeStore.id) : []),
    [state.purchases, activeStore]
  );
  const totals = useMemo(
    () => saleExpensePeriodTotals(purchases, period.year, period.month),
    [purchases, period]
  );
  const rows = saleExpenseCategoryRows(totals);
  if (!activeStore) return null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Gastos de venta</h2>
        <div className="flex items-center gap-1">
          <IconButton
            variant="secondary"
            aria-label="Mes anterior"
            onClick={() => setPeriod((p) => shiftMonth(p.year, p.month, -1))}
          >
            ‹
          </IconButton>
          <span className="text-sm text-on-surface-soft min-w-[7.5rem] text-center capitalize">
            {MONTHS[period.month - 1]} {period.year}
          </span>
          <IconButton
            variant="secondary"
            aria-label="Mes siguiente"
            onClick={() => setPeriod((p) => shiftMonth(p.year, p.month, 1))}
          >
            ›
          </IconButton>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <div key={row.category} className="flex items-center justify-between gap-2 text-sm">
            <dt className="text-on-surface-soft">{row.label}</dt>
            <dd className="font-semibold text-ink tabular-nums">{formatMoneyExact(row.amountCents / 100)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 text-sm border-t border-rule/60 pt-1.5">
          <dt className="font-semibold text-ink">Total del periodo</dt>
          <dd className="font-semibold text-ink tabular-nums">{formatMoneyExact(totals.totalCents / 100)}</dd>
        </div>
      </dl>

      {totals.lines.length > 0 && (
        <ul className="mt-3 space-y-1">
          {totals.lines.map((line) => (
            <li key={`${line.purchaseId}-${line.date}-${line.category}-${line.amountCents}-${line.description ?? ""}`}
              className="flex items-baseline justify-between gap-2 text-xs text-on-surface-soft"
            >
              <span className="min-w-0 truncate">
                {line.date.slice(8, 10)}/{line.date.slice(5, 7)} · {line.description ?? "Gasto de venta"}
              </span>
              <span className="tabular-nums shrink-0">{formatMoneyExact(line.amountCents / 100)}</span>
            </li>
          ))}
        </ul>
      )}
      {totals.lines.length === 0 && (
        <p className="mt-3 text-xs text-on-surface-soft/80">Sin gastos de venta en este periodo.</p>
      )}

      <p className="mt-3 text-xs text-on-surface-soft/70">
        Cada gasto se cuenta en el mes en que se registró (los tardíos, con su propia fecha). Los traslados para
        surtir y los gastos movidos al costo de inventario no aparecen aquí.
      </p>
    </Card>
  );
}
