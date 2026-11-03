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
import { uid } from "../../lib/ids";
import type { Order, OrderPayment } from "../../types";
import { PAYMENT_METHOD_LABELS, paymentSummary } from "./payments";
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
  const { payments, loadOrderPayments, registerOrderPayment } = useStore();
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
  const [adjustNote, setAdjustNote] = useState("");
  const [saving, setSaving] = useState(false);
  // One stable record id per user intent: a retry after an error reuses it, so
  // the same cobro can never be registered twice (idempotent registration).
  const intentIdRef = useRef<{ payment: string | null; adjust: string | null }>({
    payment: null,
    adjust: null,
  });

  useEffect(() => {
    if (!open) return;
    loadOrderPayments(order.id).catch(() => toast.error("No se pudieron cargar los cobros."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order.id]);

  const summary = paymentSummary(order, payments);
  const owed = summary.balanceCents > 0;
  // #165: the expected calendar for plan orders. Same records as the summary
  // above — received/saldo are never recomputed from a second accumulator.
  const plan = installmentPlanView(order, payments);

  async function save(input: Parameters<typeof registerOrderPayment>[1], onDone: () => void) {
    setSaving(true);
    try {
      await registerOrderPayment(order, input);
      toast.success("Cobro registrado");
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "No se pudo registrar el cobro."
      );
    } finally {
      setSaving(false);
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
    const id = intentIdRef.current.adjust ?? uid("adj");
    intentIdRef.current.adjust = id;
    await save({ kind: "adjustment", id, amountText: adjustAmountText, note: adjustNote }, () => {
      setAdjustAmountText("");
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
          <StatRow label={owed ? "Saldo" : "A favor"} tone={owed ? "danger" : "success"}>
            <Money exact amount={Math.abs(summary.balanceCents) / 100} />
          </StatRow>
        </div>

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

        {summary.records.length > 0 ? (
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

        <div className="space-y-3 border-t border-edge pt-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Monto"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
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
          <Button full disabled={saving} onClick={submitPayment}>
            Registrar cobro
          </Button>

          {adjustOpen ? (
            <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-edge">
              <p className="text-xs text-on-surface-soft">
                Los ajustes no borran cobros: quedan como registros con signo y motivo.
              </p>
              <TextField
                label="Monto del ajuste"
                inputMode="decimal"
                placeholder="-150 para devolver"
                value={adjustAmountText}
                onChange={(e) => setAdjustAmountText(e.target.value)}
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
                <Button full disabled={saving} onClick={submitAdjustment}>
                  Guardar ajuste
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" full disabled={saving} onClick={() => setAdjustOpen(true)}>
              Registrar ajuste o devolución
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
