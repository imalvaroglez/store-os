import { useEffect, useRef, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Money,
  SelectField,
  Sheet,
  StatRow,
  TextField,
  useToast,
} from "../../design-system";
import { todayIso } from "../../lib/dates";
import { orderReference } from "../../lib/orders";
import { uid } from "../../lib/ids";
import { formatMoneyExact, parseAmount, sanitizeMoneyInput } from "../../lib/money";
import type { Order, OrderPayment } from "../../types";
import { PAYMENT_METHOD_LABELS, maxAdjustmentSubtractCents, paymentSummary, signedAmountCents } from "./payments";
import { INSTALLMENT_FREQUENCY_LABELS, installmentPlanView } from "./installments";

function paymentDateLabel(p: OrderPayment): string {
  if (!p.date) return "Fecha desconocida";
  return formatDateLabel(p.date);
}

// "T00:00:00" is load-bearing: a bare yyyy-mm-dd parses as UTC and shows the
// previous day in Mexico (UTC-6), same trap OrderCard documents.
function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-MX");
}

const CUOTA_LABELS = { covered: "Cubierta", partial: "Parcial", pending: "Pendiente" } as const;

/**
 * Per-order payments (#123): chronological evidence + received/balance and a
 * minimal registration form. Records are immutable; corrections arrive as new
 * signed adjustments, so nothing here edits or deletes a payment.
 */
export function OrderPaymentsSheet({
  order,
  open,
  onClose,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
}) {
  const { payments, loadOrderPayments, registerOrderPayment, draftOwnerId } = useStore();
  const toast = useToast();
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  // Legacy deposit materialization (#123, PO 2026-11-03): the first payment of
  // an order with a pending old anticipo must carry its date/method, estimated
  // by the operator when she does not remember — never left "desconocido".
  const [inheritedMethod, setInheritedMethod] = useState<"cash" | "transfer">("cash");
  const [inheritedDate, setInheritedDate] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmountText, setAdjustAmountText] = useState("");
  const [adjustDirection, setAdjustDirection] = useState<"subtract" | "add">("subtract");
  const [adjustNote, setAdjustNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const view = useRef({ open, orderId: order.id, owner: draftOwnerId, generation: 0, mounted: true });
  if (view.current.open !== open || view.current.orderId !== order.id || view.current.owner !== draftOwnerId) {
    view.current = { ...view.current, open, orderId: order.id, owner: draftOwnerId, generation: view.current.generation + 1 };
  }
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; view.current.generation += 1; };
  }, []);

  // One stable record id per user intent: a retry after an error reuses it, so
  // the same cobro can never be registered twice (idempotent registration).
  const intentIdRef = useRef<{ payment: string | null; adjust: string | null }>({
    payment: null,
    adjust: null,
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    loadOrderPayments(order.id).catch(() => {
      if (!active) return;
      setLoadFailed(true);
      toast.error("No se pudieron cargar los cobros.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id, order.paymentsRevision, draftOwnerId, reload]);

  const summary = paymentSummary(order, payments);
  const owed = summary.balanceCents > 0;
  // #357: a fully-consumed surplus reads "Saldo $0.00", never "A favor $0.00".
  const favor = summary.balanceCents < 0;
  // #165/#168: the expected calendar for plan orders. The calendar's money
  // comes from the order DOC (transactional accumulator) — by construction the
  // same Σ as the records listed below; the breakdown loads with this sheet.
  const plan = installmentPlanView(order);

  async function save(input: Parameters<typeof registerOrderPayment>[1], onDone: () => void) {
    const generation = view.current.generation;
    const active = () => view.current.mounted && view.current.open && view.current.generation === generation;
    setSaving(true);
    try {
      await registerOrderPayment(order, input);
      if (!active()) return;
      toast.success("Cobro registrado");
      onDone();
    } catch (error) {
      if (!active()) return;
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "No se pudo registrar el cobro."
      );
    } finally {
      if (view.current.mounted) setSaving(false);
    }
  }

  async function submitPayment() {
    if (summary.inheritedPendingCents > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(inheritedDate)) {
      toast.error("Captura la fecha del anticipo previo (estímala si no la recuerdas).");
      return;
    }
    const id = intentIdRef.current.payment ?? uid("pay");
    intentIdRef.current.payment = id;
    await save(
      {
        kind: "payment",
        id,
        method,
        date,
        amountText,
        note: note.trim() || undefined,
        ...(summary.inheritedPendingCents > 0
          ? { inherited: { method: inheritedMethod, date: inheritedDate } }
          : {}),
      },
      () => {
        setAmountText("");
        setNote("");
        intentIdRef.current.payment = null;
      }
    );
  }

  async function submitAdjustment() {
    // #270 (PO 2026-11-09): a "Restar" is capped at what THIS order received.
    // Fast, friendly rejection without losing the capture; the transaction
    // re-validates against the fresh accumulator (the authoritative guard).
    if (adjustDirection === "subtract") {
      const maxCents = maxAdjustmentSubtractCents(order);
      let cents: number | null = null;
      try {
        const amount = parseAmount(adjustAmountText);
        cents = amount == null ? null : signedAmountCents(amount);
      } catch {
        cents = null; // malformed or out-of-precision: the save path reports it
      }
      if (cents != null && cents > maxCents) {
        toast.error(
          `El ajuste excede lo recibido en este pedido. Puedes restar hasta ${formatMoneyExact(maxCents / 100)}.`
        );
        return;
      }
    }
    const id = intentIdRef.current.adjust ?? uid("adj");
    intentIdRef.current.adjust = id;
    await save({ kind: "adjustment", id, direction: adjustDirection, amountText: adjustAmountText, note: adjustNote }, () => {
      setAdjustAmountText("");
      setAdjustDirection("subtract");
      setAdjustNote("");
      setAdjustOpen(false);
      intentIdRef.current.adjust = null;
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Cobros del pedido">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatRow label="Total">
            <Money exact amount={summary.totalCents / 100} />
          </StatRow>
          <StatRow label="Recibido">
            <Money exact amount={summary.receivedCents / 100} />
          </StatRow>
          <StatRow label={favor ? "A favor" : "Saldo"} tone={owed ? "danger" : favor ? "success" : "default"}>
            <Money exact amount={Math.abs(summary.balanceCents) / 100} />
          </StatRow>
        </div>

        {summary.creditAppliedCents > 0 && (
          <div className="space-y-1 rounded-xl bg-surface p-3 ring-1 ring-edge">
            <p className="text-sm">
              Total del pedido: <Money exact amount={summary.totalCents / 100} />
              {" "}· Saldo a favor aplicado: <Money exact amount={summary.creditAppliedCents / 100} />
              {" "}· Pendiente por pagar: <Money exact amount={Math.max(0, summary.balanceCents) / 100} />
            </p>
            {(order.creditLedger ?? []).filter((entry) => entry.kind === "application").length > 0 && (
              <ul className="text-xs text-on-surface-soft space-y-0.5">
                {(order.creditLedger ?? []).filter((entry) => entry.kind === "application").map((entry) => (
                  <li key={entry.id}>
                    <Money exact amount={entry.amountCents / 100} /> del pedido{" "}
                    {orderReference(entry.fromOrderId)} · {new Date(entry.at).toLocaleDateString("es-MX")}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-on-surface-soft">
              El saldo a favor sale de otro pedido de la clienta con dinero de más; no es un cobro nuevo.
            </p>
          </div>
        )}

        {summary.inheritedPendingCents > 0 && (
          <div className="space-y-2 rounded-xl bg-surface p-3 ring-1 ring-edge">
            <p className="text-xs text-on-surface-soft">
              Anticipo previo: <Money exact amount={summary.inheritedPendingCents / 100} /> recibido
              antes de llevar registro. Se materializa junto con el primer cobro — captura su fecha
              y método (estímalos si no los recuerdas).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Método del anticipo"
                value={inheritedMethod}
                onChange={(m) => setInheritedMethod(m)}
                options={[
                  { value: "cash", label: PAYMENT_METHOD_LABELS.cash },
                  { value: "transfer", label: PAYMENT_METHOD_LABELS.transfer },
                ]}
              />
              <TextField
                label="Fecha del anticipo"
                type="date"
                value={inheritedDate}
                onChange={(e) => setInheritedDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {plan && (
          <section className="space-y-2" aria-label="Calendario previsto">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-on-surface">Calendario previsto</h4>
              <Badge tone={plan.coveredCount === plan.cuotas.length ? "success" : "neutral"}>
                {plan.coveredCount} de {plan.cuotas.length} cubiertas
              </Badge>
            </div>
            <p className="text-xs text-on-surface-soft">
              {INSTALLMENT_FREQUENCY_LABELS[plan.plan.frequency]} · última fecha {formatDateLabel(plan.lastDueDate)}
              {plan.lateCount > 0 && ` · ${plan.lateCount} ${plan.lateCount === 1 ? "cuota atrasada" : "cuotas atrasadas"} (informativo)`}
            </p>
            <ul className="divide-y divide-edge">
              {plan.cuotas.map((cuota) => (
                <li key={cuota.index} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-on-surface">
                      Cuota {cuota.index} · {formatDateLabel(cuota.dueDate)}
                    </p>
                    <p className="text-xs text-on-surface-soft">
                      Cubierto: <Money exact amount={cuota.coveredCents / 100} /> de{" "}
                      <Money exact amount={cuota.amountCents / 100} />
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="serif-display tnum">
                      <Money exact amount={cuota.amountCents / 100} />
                    </span>
                    {cuota.late ? (
                      <Badge tone="warning">Atrasada</Badge>
                    ) : (
                      <Badge tone={cuota.status === "covered" ? "success" : cuota.status === "partial" ? "warning" : "neutral"}>
                        {CUOTA_LABELS[cuota.status]}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-on-surface-soft">
              {plan.reserved
                ? "Piezas apartadas desde el primer abono confirmado."
                : "El pedido se aparta con el primer abono confirmado."}
              {plan.deliveryBlocked
                ? " La entrega se habilita al liquidar el total."
                : " Total liquidado: puedes confirmar la entrega manualmente."}
            </p>
          </section>
        )}

        {loading ? (
          <p role="status" className="text-sm text-on-surface-soft">Cargando cobros…</p>
        ) : loadFailed ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-danger">No se pudo cargar el detalle. Vuelve a cargarlo antes de registrar otro cobro.</p>
            <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>Volver a cargar cobros</Button>
          </div>
        ) : summary.records.length > 0 ? (
          <ul className="divide-y divide-edge" aria-label="Cobros registrados">
            {summary.records.map((p) => (
              <li key={p.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-on-surface">
                    {paymentDateLabel(p)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                    {p.kind === "adjustment" && (
                      <span className="ml-1 align-middle">
                        <Badge tone="warning">Ajuste</Badge>
                      </span>
                    )}
                  </p>
                  {p.note && <p className="text-xs text-on-surface-soft">{p.note}</p>}
                </div>
                <span
                  className={`serif-display tnum shrink-0 ${
                    p.amount < 0 ? "text-danger" : "text-on-surface"
                  }`}
                >
                  <Money exact amount={p.amount} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          summary.inheritedPendingCents === 0 && (
            <p className="text-sm text-on-surface-soft">Sin cobros registrados.</p>
          )
        )}

        {order.depositCorrections?.length ? (
          <div className="space-y-1 rounded-xl bg-surface p-3 ring-1 ring-edge">
            <p className="text-xs font-semibold text-on-surface">Correcciones del anticipo</p>
            {order.depositCorrections.map((correction, index) => (
              <p key={`${correction.at}-${index}`} className="text-xs text-on-surface-soft">
                {formatMoneyExact(correction.from)} → {formatMoneyExact(correction.to)} — {correction.note} ·{" "}
                {formatDateLabel(correction.at.slice(0, 10))}
              </p>
            ))}
          </div>
        ) : null}

        <div className="space-y-3 border-t border-edge pt-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Monto"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => setAmountText(sanitizeMoneyInput(e.target.value))}
            />
            <SelectField
              label="Método"
              value={method}
              onChange={(m) => setMethod(m)}
              options={[
                { value: "cash", label: PAYMENT_METHOD_LABELS.cash },
                { value: "transfer", label: PAYMENT_METHOD_LABELS.transfer },
              ]}
            />
          </div>
          <TextField
            label="Fecha de recepción"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="Nota (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="p. ej. abono en efectivo"
          />
          <Button full disabled={saving || loading || loadFailed} onClick={submitPayment}>
            Registrar cobro
          </Button>

          {adjustOpen ? (
            <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-edge">
              <p className="text-xs text-on-surface-soft">
                Los ajustes no borran cobros: quedan como registros con signo y motivo.
              </p>
              {adjustDirection === "subtract" && (
                <p className="text-xs text-on-surface-soft">
                  Puedes restar hasta {formatMoneyExact(maxAdjustmentSubtractCents(order) / 100)} — lo
                  cobrado en este pedido.{" "}
                  {/* #288: with a pending legacy anticipo, Recibido shows accumulator +
                      anticipo while the cap counts only cobros — same screen, two
                      numbers. One line connects them instead of reading like a bug. */}
                  {summary.inheritedPendingCents > 0 && (
                    <>
                      El tope es menor que Recibido porque el anticipo previo de{" "}
                      {formatMoneyExact(summary.inheritedPendingCents / 100)} se cuenta al recibir,
                      no al restar; se materializa con el primer cobro.{" "}
                    </>
                  )}
                  Para devolver más, usa el botón «Incidencia» de este pedido
                  {summary.inheritedPendingCents > 0
                    ? // #288 UX mission: the motive is only demanded when the order has
                      // payment evidence — with a bare pending anticipo the edit is free,
                      // and the parenthetical must not over-promise.
                      `; y para corregir el anticipo, edítalo en el pedido${
                        summary.records.length > 0 || (order.paymentsReceivedCents ?? 0) > 0 ? " (te pedirá el motivo)" : ""
                      }.`
                    : "."}
                </p>
              )}
              <SelectField
                label="Dirección"
                value={adjustDirection}
                onChange={setAdjustDirection}
                options={[
                  { value: "subtract", label: "Restar (devolución)" },
                  { value: "add", label: "Sumar" },
                ]}
              />
              <TextField
                label="Monto del ajuste"
                inputMode="decimal"
                placeholder="150 para devolver"
                value={adjustAmountText}
                onChange={(e) => setAdjustAmountText(sanitizeMoneyInput(e.target.value.replace(/[+-]/g, "")))}
              />
              <TextField
                label="Motivo"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="p. ej. devolución en efectivo"
              />
              <div className="flex gap-2">
                <Button variant="secondary" full disabled={saving} onClick={() => setAdjustOpen(false)}>
                  Cancelar
                </Button>
                <Button full disabled={saving || loading || loadFailed} onClick={submitAdjustment}>
                  Guardar ajuste
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" full disabled={saving || loading || loadFailed} onClick={() => setAdjustOpen(true)}>
              Registrar ajuste o devolución
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
