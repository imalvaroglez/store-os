import { useEffect, useState } from "react";
import { Button, Card, Dialog, Money, StatRow, TextField, useToast } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { positionOfStore, PURCHASE_PAYMENT_METHOD_LABEL } from "./position";
import { todayIso } from "../../lib/dates";
import { parseAmount } from "../../lib/money";
import { formatMoneyExact } from "../../lib/money";

// #279 frente 1: the from-activation position on Inicio — three registered
// figures (never bank-confirmed), the activation cut visible, card payments
// recorded from here (they reduce cash AND debt; never a second expense).
// Loads on demand: two bounded reads, no listener.

/** YYYY-MM-DD rendered in the OPERATOR's timezone — a date-only string parsed
 * as UTC would show the previous day in es-MX. */
function formatDay(day: string): string {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function FinancialPositionCard() {
  const { state, activeStore, payments, financial, loadFinancialPosition, registerCardPayment } = useStore();
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // #279 r3 B2: an overpayment is accepted only EXPLICITLY — the first tap
  // arms the confirmation (with the excess named), the second registers.
  const [armedOverpay, setArmedOverpay] = useState(false);

  useEffect(() => {
    if (activeStore && financial.status === "idle") void loadFinancialPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore?.id, financial.status]);

  useEffect(() => {
    if (!isOverpay) setArmedOverpay(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountText]);

  if (!activeStore) return null;

  const position = financial.status === "ready" && financial.activatedAt
    ? positionOfStore({
        activatedAt: financial.activatedAt,
        storeId: activeStore.id,
        payments,
        purchases: state.purchases.filter((purchase) => purchase.storeId === activeStore.id),
        expenses: state.expenses.filter((expense) => expense.storeId === activeStore.id),
        cardPayments: financial.cardPayments,
      })
    : null;

  const cardDebtCents = position?.cardDebtCents ?? 0;
  const draftAmountCents = (() => {
    const amount = parseAmount(amountText);
    return amount !== undefined ? Math.round(amount * 100) : 0;
  })();
  const overpayCents = position && draftAmountCents > 0 ? draftAmountCents - cardDebtCents : 0;
  const isOverpay = overpayCents > 0;

  async function savePayment() {
    const amountCents = draftAmountCents;
    if (!(amountCents > 0)) {
      toast.error("El importe del pago debe ser mayor que cero.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("La fecha del pago no es válida.");
      return;
    }
    setSaving(true);
    try {
      await registerCardPayment({ amountCents, date, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success("Pago de tarjeta registrado.");
      setPayOpen(false);
      setAmountText("");
      setNote("");
      setDate(todayIso());
    } catch (error) {
      console.error("[Financial] Error al registrar el pago de tarjeta:", error);
      toast.error("No se pudo registrar el pago de tarjeta. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-ink text-sm">Posición desde activación</h3>
        <div className="flex items-center gap-2">
          {financial.activatedAt && (
            <span className="text-xs text-on-surface-soft">
              desde {formatDay(financial.activatedAt)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => setPayOpen(true)}>Pago de tarjeta</Button>
        </div>
      </div>
      {financial.status === "loading" && <p className="mt-2 text-xs text-on-surface-soft">Cargando la posición…</p>}
      {financial.status === "error" && (
        <div className="mt-2 flex items-center gap-2">
          <p className="text-xs text-danger">No se pudo cargar la posición.</p>
          <Button variant="ghost" size="sm" onClick={() => void loadFinancialPosition()}>Reintentar</Button>
        </div>
      )}
      {position && (
        <>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 min-w-0">
            <StatRow label="Caja registrada" tone={position.registeredCashCents < 0 ? "danger" : "default"}>
              <Money exact amount={position.registeredCashCents / 100} />
            </StatRow>
            <StatRow label="Adeudo tarjeta" tone={position.cardDebtCents > 0 ? "danger" : "default"}>
              <Money exact amount={position.cardDebtCents / 100} />
            </StatRow>
            <StatRow label="Adeudo con tercero" tone={position.thirdPartyDebtCents > 0 ? "danger" : "default"}>
              <Money exact amount={position.thirdPartyDebtCents / 100} />
            </StatRow>
          </div>
          <ul className="mt-2 space-y-0.5">
            {position.unclassifiedOutflowsCents > 0 && (
              <li className="text-xs text-on-surface-soft">
                Salidas sin forma de pago ({formatMoneyExact(position.unclassifiedOutflowsCents / 100)}) fuera de estas cifras — clasifícalas editando su compra o gasto.
              </li>
            )}
            {position.notes.map((noteText) => (
              <li key={noteText} className="text-xs text-on-surface-soft">{noteText}</li>
            ))}
          </ul>
        </>
      )}
      {payOpen && (
        <Dialog open onClose={() => setPayOpen(false)} title="Pago de tarjeta">
          <div className="space-y-3">
            <p className="text-sm text-on-surface-soft">
              Reduce el adeudo de tarjeta y la caja registrada. No es un gasto: la compra ya está registrada.
            </p>
            <TextField label="Importe" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            <TextField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <TextField label="Nota (opcional)" placeholder="p. ej. pago parcial noviembre" value={note} onChange={(e) => setNote(e.target.value)} />
            {isOverpay && (
              <p className="text-sm text-danger">
                El importe excede el adeudo de tarjeta por {formatMoneyExact(overpayCents / 100)} (adeudo actual: {formatMoneyExact(cardDebtCents / 100)}). Confirma que realmente pagaste de más.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setPayOpen(false); setArmedOverpay(false); }}>Cancelar</Button>
              {isOverpay && !armedOverpay ? (
                <Button disabled={saving} onClick={() => setArmedOverpay(true)}>Registrar pago</Button>
              ) : (
                <Button disabled={saving} onClick={() => void savePayment()}>{saving ? "Guardando…" : isOverpay ? "Confirmar sobre-pago" : "Registrar pago"}</Button>
              )}
            </div>
          </div>
        </Dialog>
      )}
      <p className="mt-2 text-[11px] text-on-surface-soft">
        Formas de pago reconocidas: {Object.values(PURCHASE_PAYMENT_METHOD_LABEL).join(" · ")} — se capturan una sola vez en cada compra o gasto.
      </p>
    </Card>
  );
}
