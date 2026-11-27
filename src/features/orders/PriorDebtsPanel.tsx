import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, Money } from "../../design-system";
import { orderReference } from "../../lib/orders";
import { priorDebtsView } from "./customerCredit";
import { ORDER_STATUS_LABELS } from "./orderStatus";

/**
 * #559: the clienta's prior debts, next to the saldo of the order being
 * consulted. Visibility and traceability only — cobros stay per-order under
 * the standing contract; this adds no writes, listeners or reads (pure
 * derivation over the already-loaded orders, exact cents).
 *
 * Density rule (PO 2026-11-10): two aligned rows inside the SAME summary —
 * never a second card; the per-order evidence is one tap away, and the whole
 * panel disappears when there is nothing cross-order to say.
 */
export function PriorDebtsPanel({
  storeId,
  customerId,
  currentOrderId,
  currentPendingCents,
  currentCreditCents = 0,
  pendingSync = false,
  expanded = false,
  onVisitOrder,
}: {
  storeId: string;
  /** The clienta being consulted (the editor's PICK, so a change follows). */
  customerId?: string;
  currentOrderId: string;
  /** This order's net pending balance (draft or saved), in exact cents. */
  currentPendingCents: number;
  /** This order's own unconsumed surplus, in exact cents (0 when it owes). */
  currentCreditCents?: number;
  /** Editor: the current figures are a draft — not yet synced to the cloud. */
  pendingSync?: boolean;
  /** Cobros shows the per-order list inline; the editor keeps it compact. */
  expanded?: boolean;
  onVisitOrder: (orderId: string) => void;
}) {
  const { state } = useStore();
  const view = useMemo(
    () => (customerId ? priorDebtsView(state.orders ?? [], storeId, customerId, currentOrderId) : null),
    [state.orders, storeId, customerId, currentOrderId],
  );
  const [open, setOpen] = useState(expanded);

  if (!customerId || !view) return null;

  const grossCents = view.priorPendingCents + Math.max(0, currentPendingCents);
  // #189: her available credit auto-compensates oldest-first, so the total to
  // collect is NET of it — applied credit is already inside each pending row,
  // and the available amount is discounted exactly once here.
  const creditCents = view.priorCreditCents + Math.max(0, currentCreditCents);
  const totalCents = Math.max(0, grossCents - creditCents);
  const leftoverCreditCents = Math.max(0, creditCents - grossCents);

  // Nothing cross-order to say: a lone order's saldo already tells the story.
  if (view.rows.length === 0 && view.priorCreditCents === 0) return null;
  // Credit with nothing owed anywhere is the ficha's story, not the saldo's.
  if (grossCents <= 0) return null;

  return (
    <div data-prior-debts className="space-y-1.5 border-t border-edge pt-2" aria-label="Adeudos anteriores de la clienta">
      {view.rows.length > 0 && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-on-surface-soft">
            Adeudo anterior{view.rows.length > 1 ? ` (${view.rows.length} pedidos)` : ""}
          </span>
          <Money exact amount={view.priorPendingCents / 100} muted />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide font-medium text-on-surface">Por cobrar en total</span>
        <span className="font-bold">
          <Money exact amount={totalCents / 100} />
        </span>
      </div>
      {creditCents > 0 && (
        <p className="text-xs text-on-surface-soft">
          Ya se descuenta su saldo a favor disponible de <Money exact amount={creditCents / 100} />; la
          compensación va primero a los pedidos más antiguos.
        </p>
      )}
      {leftoverCreditCents > 0 && (
        <p className="text-xs text-on-surface-soft">
          Le quedaría <Money exact amount={leftoverCreditCents / 100} /> a favor.
        </p>
      )}
      {view.rows.length > 0 && (
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "Ocultar pedidos pendientes" : `Ver pedidos pendientes${view.rows.length > 1 ? ` (${view.rows.length})` : ""}`}
          </Button>
          {open && (
            <ul className="space-y-1">
              {view.rows.map((row) => (
                <li key={row.orderId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-on-surface">
                    Pedido {orderReference(row.orderId)} · {ORDER_STATUS_LABELS[row.orderStatus]}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Money exact amount={row.pendingCents / 100} />
                    <Button variant="ghost" size="sm" onClick={() => onVisitOrder(row.orderId)}>
                      Ver pedido
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pendingSync && (
        <p className="text-xs text-on-surface-soft">
          El saldo de este pedido es tu captura sin guardar; el adeudo anterior viene de pedidos guardados.
        </p>
      )}
    </div>
  );
}
