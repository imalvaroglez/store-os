import { useRef, useState } from "react";
import type { Order, OrderDeliveryLine, Product } from "../../types";
import { Badge, Button, Dialog, Money, Sheet, StatRow, TextField, useToast } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { pendingDeliveries, pendingDeliveryPieces, deliveryValidationError } from "../../lib/deliveries";
import { orderItems, orderTotals } from "../../lib/orders";
import { todayIso, formatDate } from "../../lib/dates";
import { uid } from "../../lib/ids";
import { sanitizeIntegerInput } from "../../lib/money";
import { DeliveryWithBalanceError } from "../../app/firebase/firestoreData";
import { formatMoneyExact } from "../../lib/money";

// #333: registering WHAT was handed to the clienta — one append-only event
// per entrega with its EFFECTIVE date (a late capture keeps the real date and
// its audit trail). Partial deliveries are first-class: the order only reads
// as Entregado when every piece has evidence, and completing with an
// uncovered saldo demands the operator's explicit confirmation (#165/#168).
export function DeliverySheet({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const { registerDelivery, state } = useStore();
  const toast = useToast();
  const pending = pendingDeliveries(order);
  const totals = orderTotals(order);
  const orderedPieces = orderItems(order).reduce((sum, item) => sum + item.quantity, 0);
  const pendingPieces = pendingDeliveryPieces(order);
  const [quantityText, setQuantityText] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [balanceConfirmCents, setBalanceConfirmCents] = useState<number | null>(null);
  // Stable per attempt: a retry after an error reuses the id so the append is
  // idempotent — a resend can never duplicate the entrega.
  const attemptIdRef = useRef<string>(uid("dev"));
  const quantityFor = (key: string, remaining: number) => quantityText[key] ?? String(remaining);

  const nameFor = (productId: string, variantId?: string): string => {
    const product = state.products.find((candidate) => candidate.id === productId);
    const variant = variantId ? product?.variants?.find((candidate) => candidate.id === variantId) : undefined;
    return [product?.name ?? "Pieza", variant?.color].filter(Boolean).join(" · ");
  };

  async function submit(confirmDeliveredWithBalance = false) {
    const lines: OrderDeliveryLine[] = pending
      .map((line) => ({
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        quantity: Math.max(0, Math.round(Number(quantityFor(line.key, line.quantity)) || 0)),
      }))
      .filter((line) => line.quantity > 0);
    const validation = deliveryValidationError(order, { lines });
    if (validation) {
      toast.error(validation);
      return;
    }
    setSaving(true);
    try {
      await registerDelivery(order, { id: attemptIdRef.current, lines, deliveredAt: date }, { confirmDeliveredWithBalance });
      const entered = new Map(lines.map((line) => [`${line.productId}${line.variantId ? `:${line.variantId}` : ""}`, line.quantity]));
      const completes = pending.every((line) => entered.get(line.key) === line.quantity);
      toast.success(completes ? "Entrega registrada. Pedido entregado por completo." : "Entrega parcial registrada.");
      onClose();
    } catch (error) {
      if (error instanceof DeliveryWithBalanceError) {
        setBalanceConfirmCents(error.balanceCents);
      } else {
        toast.error(error instanceof Error ? error.message : "No se pudo registrar la entrega.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Entrega del pedido">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatRow label="Piezas del pedido">{orderedPieces}</StatRow>
          <StatRow label="Entregadas">{orderedPieces - pendingPieces}</StatRow>
          <StatRow label="Pendientes" tone={pendingPieces > 0 ? "danger" : "success"}>{pendingPieces}</StatRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatRow label="Total">{<Money exact amount={totals.estimatedTotal} />}</StatRow>
          <StatRow label="Saldo" tone={totals.balance > 0 ? "danger" : "success"}>{<Money exact amount={Math.abs(totals.balance)} />}</StatRow>
        </div>
        {(order.deliveries ?? []).length > 0 && (
          <ul className="divide-y divide-edge" aria-label="Entregas registradas">
            {(order.deliveries ?? []).map((event) => (
              <li key={event.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-on-surface">{formatDate(event.deliveredAt)}</p>
                  <p className="text-xs text-on-surface-soft">
                    {event.lines.map((line) => `${line.quantity} × ${nameFor(line.productId, line.variantId)}`).join(", ")}
                  </p>
                </div>
                <Badge tone="neutral">registrada el {formatDate(event.recordedAt.slice(0, 10))}</Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-edge">
          {pending.map((line) => (
            <div key={line.key} className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-on-surface break-words">{nameFor(line.productId, line.variantId)}</p>
                <p className="text-xs text-on-surface-soft">Pendientes: {line.quantity}</p>
              </div>
              <div className="w-28 shrink-0">
                <TextField
                  label="Entregar"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quantityFor(line.key, line.quantity)}
                  onChange={(event) =>
                    setQuantityText((current) => ({ ...current, [line.key]: sanitizeIntegerInput(event.target.value) }))
                  }
                />
              </div>
            </div>
          ))}
          <TextField label="Fecha de entrega" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <p className="text-xs text-on-surface-soft">
            La fecha es la del día en que la clienta recibió las piezas; si registras tarde, escribe la fecha real.
          </p>
        </div>
        <Button full disabled={saving || pending.length === 0} onClick={() => void submit()}>
          {saving ? "Registrando…" : "Registrar entrega"}
        </Button>
        <Dialog
          open={balanceConfirmCents !== null}
          title="Entregar con saldo pendiente"
          onClose={() => setBalanceConfirmCents(null)}
          footer={
            <div className="flex w-full flex-col gap-2">
              <Button full onClick={() => { setBalanceConfirmCents(null); void submit(true); }}>
                Entregar y registrar autorización
              </Button>
              <Button full variant="secondary" onClick={() => setBalanceConfirmCents(null)}>Cancelar</Button>
            </div>
          }
        >
          <p>
            Este pedido queda con un saldo de {formatMoneyExact((balanceConfirmCents ?? 0) / 100)} sin cobrar. Entregar
            requiere tu confirmación; queda registrada como autorización (quién, cuándo y cuánto).
          </p>
        </Dialog>
      </div>
    </Sheet>
  );
}

// Re-export for the card's compact progress line.
export function deliveryProgressLabel(order: Order, products: Pick<Product, "id">[] = []): string | null {
  void products;
  const ordered = orderItems(order).reduce((sum, item) => sum + item.quantity, 0);
  const pending = pendingDeliveryPieces(order);
  if (ordered === 0 || (order.deliveries ?? []).length === 0) return null;
  if (pending === 0) return "Entregado por completo";
  return `Entregadas ${ordered - pending} de ${ordered} piezas`;
}
