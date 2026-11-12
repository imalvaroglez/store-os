import { useRef, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Money,
  PAYMENT_STATUS_TONE,
  ORDER_STATUS_TONE,
  StatRow,
  Sheet,
  TextArea,
  useToast,
} from "../../design-system";
import { legacyCollectDeposit, orderItems, orderReference, orderTotals, paymentStatusForOrder, effectiveOrderStatus } from "../../lib/orders";
import { shortageByDimension } from "../../lib/inventory";
import { orderTicketData, orderTicketText, receiptFileName } from "./orderTicket";
import { OrderReceipt } from "./OrderReceipt";
import { orderProfitBreakdown } from "../../lib/saleProfit";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, nextActionVerb, advanceOrder } from "./orderStatus";
import { installmentPlanView } from "./installments";
import { OrderPaymentsSheet } from "./OrderPaymentsSheet";
import { IncidentSheet } from "./IncidentSheet";
import { DeliverySheet, deliveryProgressLabel } from "./DeliverySheet";
import { pendingDeliveries, effectiveDeliveryDate } from "../../lib/deliveries";
import { PackagingSheet } from "./PackagingSheet";
import type { Order } from "../../types";

export function OrderCard({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const { upsertOrder, state, activeStore } = useStore();
  const [ticketOpen, setTicketOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [packagingOpen, setPackagingOpen] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const toast = useToast();
  const customer = state.customers.find((c) => c.id === order.customerId && c.storeId === order.storeId);
  const items = orderItems(order);
  const totals = orderTotals(order);
  const paymentStatus = paymentStatusForOrder(order);
  const status = effectiveOrderStatus(order);
  const verb = nextActionVerb(status);
  // #165/#168 read model for plan orders: Recibido/Saldo come from the order
  // doc's transactional accumulator, so the card is correct right after a
  // reload. The per-cobro breakdown still only loads when Cobros opens.
  const planView = order.installments ? installmentPlanView(order) : null;
  const hasPaymentRecords = typeof order.paymentsReceivedCents === "number";
  const owed = planView ? planView.balanceCents > 0 : totals.balance > 0;
  const deliveryHeld = !!planView?.deliveryBlocked && verb === "Entregar";
  // Full-cost profit (FER-03): precio − costo de compra − gastos de venta por
  // pieza. A cancelled order is a full return: its profit is not realized, so
  // no estimate is shown. Cash collected (Total/Pagado/Saldo) stays separate.
  const profitView = status === "cancelled" ? undefined : orderProfitBreakdown(order, state.purchases);
  // #309: the shared canonical derivation — negative stock on the exact
  // dimension each line moves (variant stock for variant lines), so the card
  // badge, the editor and the category review can never disagree.
  const shortages = [...shortageByDimension(items, state.products).values()];
  const preview = items.slice(0, 3).map((item) => `${item.quantity} × ${item.productName}`).join(", ");
  // "T00:00:00" is load-bearing: a bare yyyy-mm-dd parses as UTC and shows the
  // previous day in Mexico (UTC-6).
  const orderDate = order.promisedDate
    ? `Prometido: ${new Date(`${order.promisedDate}T00:00:00`).toLocaleDateString("es-MX")}`
    : order.createdAt ? `Creado: ${new Date(order.createdAt).toLocaleDateString("es-MX")}` : "Sin fecha";

  /** #308 (+ revisión adversarial): name the PDF the browser suggests —
   * Pedido-<REF>-<Clienta> — via document.title while the print dialog is
   * open. Re-entry (iOS double-tap: print is non-blocking there and
   * afterprint never fires) must not re-capture the receipt name as
   * "previous" and stick it forever. */
  const printingRef = useRef(false);
  function printReceipt() {
    if (printingRef.current) return;
    printingRef.current = true;
    const previous = document.title;
    document.title = receiptFileName(order.id, order.customerName || customer?.name);
    let timer = 0;
    const restore = () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", restore);
      document.title = previous;
      printingRef.current = false;
    };
    window.addEventListener("afterprint", restore, { once: true });
    window.print();
    // Fallback where afterprint never fires; long enough that non-blocking
    // dialogs usually read the titled document before we restore.
    timer = window.setTimeout(restore, 1_500);
  }

  async function advance() {
    const advanced = advanceOrder(order);
    if (!advanced) return;
    try {
      await upsertOrder(advanced);
      toast.success(`Pedido avanzado a «${ORDER_STATUS_LABELS[advanced.orderStatus]}»`);
    } catch {
      toast.error("No se pudo actualizar el pedido.");
    }
  }

  /** One-tap payment collection: the deposit rises by the NET pending amount
   * — saldo a favor applied from a sister order is the clienta's money already
   * received there (#189) and must never be counted as cash here. */
  async function collect() {
    try {
      const saved = await upsertOrder({
        ...order,
        deposit: legacyCollectDeposit(order),
        updatedAt: new Date().toISOString(),
      });
      if (orderTotals(saved).balance > 0) {
        toast.info("Este pedido ya tiene cobros registrados. Regístralos en Cobros.");
        setPaymentsOpen(true);
        return;
      }
      toast.success("Pedido cobrado");
    } catch {
      toast.error("No se pudo registrar el cobro.");
    }
  }

  const ticket = ticketOpen ? orderTicketText(order, activeStore?.name ?? "Tienda", customer?.name) : "";
  async function copyTicket() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(ticket);
      setCopyFailed(false);
      toast.success("Detalle copiado");
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <>
    <Card onClick={onEdit} className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">#{orderReference(order.id)} · {order.customerName || customer?.name || "Sin cliente"}</h3>
          <p className="text-xs text-ink-soft truncate">{preview || "Sin productos"}{items.length > 3 && " …"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
          {planView ? (
            <>
              <Badge tone="info">Pagos por partes</Badge>
              {planView.reserved && <Badge tone="success">Apartado</Badge>}
            </>
          ) : (
            <Badge tone={PAYMENT_STATUS_TONE[paymentStatus]}>{PAYMENT_STATUS_LABELS[paymentStatus]}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3 text-xs text-ink-soft">
        <span>{items.length} {items.length === 1 ? "producto" : "productos"}</span>
        <span>·</span>
        <span>{totals.pieces} {totals.pieces === 1 ? "pieza" : "piezas"}</span>
        <span>·</span>
        <span>{orderDate}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
        <StatRow label="Total"><Money exact amount={totals.estimatedTotal} /></StatRow>
        {planView ? (
          <>
            <StatRow label="Recibido"><Money exact amount={planView.receivedCents / 100} /></StatRow>
            <StatRow
              label={planView.balanceCents > 0 ? "Saldo" : totals.availableCredit > 0 ? "A favor" : "Saldo"}
              tone={planView.balanceCents > 0 ? "danger" : totals.availableCredit > 0 ? "success" : "default"}
            >
              {/* #189: a creditor's real "A favor" is the UNCONSUMED surplus.
               * #357: fully consumed reads "Saldo $0.00", matching Cobros. */}
              <Money exact amount={planView.balanceCents > 0 ? planView.balanceCents / 100 : totals.availableCredit} />
            </StatRow>
          </>
        ) : (
          <>
            <StatRow label={hasPaymentRecords ? "Recibido" : "Pagado"}><Money exact amount={totals.paid} /></StatRow>
            <StatRow
              label={totals.availableCredit > 0 ? "A favor" : "Saldo"}
              tone={totals.balance > 0 ? "danger" : totals.availableCredit > 0 ? "success" : "default"}
            >
              <Money exact amount={totals.availableCredit > 0 ? totals.availableCredit : totals.balance} />
            </StatRow>
          </>
        )}
      </div>
      {totals.appliedCredit > 0 && (
        <p className="text-xs text-ink-soft mt-1">
          Ya se aplicó un saldo a favor de <Money exact amount={totals.appliedCredit} /> de otro pedido de la clienta.
        </p>
      )}
      {profitView && profitView.profitCents != null && (
        <p className="text-xs text-ink-soft mt-2">
          Ganancia estimada: <Money exact className={profitView.profitCents < 0 ? "text-danger" : ""} amount={profitView.profitCents / 100} />
          {" "}· costo de compra <Money exact amount={profitView.acquisitionCents / 100} />
          {profitView.saleExpenseCents > 0 && <> · gastos de venta <Money exact amount={profitView.saleExpenseCents / 100} /></>}
          {profitView.linesWithoutCost > 0 && ` · ${profitView.linesWithoutCost} ${profitView.linesWithoutCost === 1 ? "línea sin costo" : "líneas sin costo"}`}
        </p>
      )}
      {profitView && profitView.profitCents == null && <p className="text-xs text-ink-soft mt-2">Ganancia estimada: sin costo registrado.</p>}
      {shortages.length > 0 && <Badge tone="warning">Faltan {shortages.reduce((sum, shortage) => sum + shortage.missing, 0)} piezas</Badge>}

      <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" onClick={() => { setCopyFailed(false); setTicketOpen(true); }}>Ver detalle para compartir</Button>
        <Button variant="ghost" onClick={() => setPaymentsOpen(true)}>Cobros</Button>
        {order.orderStatus !== "cancelled" && (activeStore?.packaging?.materials.length ?? 0) > 0 && (
          <Button variant="ghost" onClick={() => setPackagingOpen(true)}>Empaques</Button>
        )}
        {(order.deliveries ?? []).length > 0 && status !== "cancelled" && (
          <Button variant="ghost" onClick={() => setDeliveryOpen(true)}>Entregas</Button>
        )}
        {(status !== "cancelled" || (order.incidents?.length ?? 0) > 0) && (
          <Button variant="ghost" onClick={() => setIncidentOpen(true)}>Incidencia{(order.incidents?.length ?? 0) > 0 ? ` (${order.incidents!.length})` : ""}</Button>
        )}
      </div>
      {(verb || owed) && (
        <div className="mt-3 flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
          <div className="flex gap-2">
            {verb && (
              <Button
                full
                disabled={deliveryHeld}
                onClick={() => {
                  // #333: delivering registers WHAT was handed (per piece, with
                  // its effective date) instead of a bare status flip. Orders
                  // without product lines keep the plain advance.
                  if (verb === "Entregar" && pendingDeliveries(order).length > 0) setDeliveryOpen(true);
                  else void advance();
                }}
              >
                {verb}
              </Button>
            )}
            {planView ? (
              owed && (
                <Button variant="secondary" full onClick={() => setPaymentsOpen(true)}>Abonar</Button>
              )
            ) : (
              totals.balance > 0 && (
                <Button variant="secondary" full onClick={hasPaymentRecords ? () => setPaymentsOpen(true) : collect}>Cobrar</Button>
              )
            )}
          </div>
          {deliveryHeld && (
            <p className="text-xs text-on-surface-soft">La entrega se habilita al liquidar el total.</p>
          )}
        </div>
      )}
      {/* #333: delivery progress and the missing-evidence note show on ANY
          status — a delivered-and-paid card had no action row to host them. */}
      {deliveryProgressLabel(order) && (
        <p className="text-xs text-ink-soft">{deliveryProgressLabel(order)}</p>
      )}
      {status === "delivered" && !effectiveDeliveryDate(order) && (order.deliveries ?? []).length === 0 && (
        <p className="text-xs text-on-surface-soft">Fecha de entrega por confirmar.</p>
      )}
    </Card>
    <Sheet open={ticketOpen} onClose={() => setTicketOpen(false)} title="Detalle para compartir">
      {/* #307: wide screens put the copyable text (left) beside the receipt
          (right) — each panel owns its action; narrow screens stack them in
          task order (texto → copiar → recibo → imprimir) without horizontal
          scroll. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <TextArea label="Detalle del pedido" value={ticket} readOnly rows={Math.min(16, Math.max(6, ticket.split("\n").length))} />
          {copyFailed && <p className="text-danger">No se pudo copiar. Selecciona el texto y cópialo manualmente.</p>}
          <Button full className="mt-auto" onClick={copyTicket}>Copiar detalle</Button>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {/* Printable receipt (#139): same canonical money as the text above. */}
          <OrderReceipt
            data={orderTicketData(order, activeStore?.name ?? "Tienda", customer?.name)}
            whatsapp={activeStore?.whatsappPhone}
          />
          <Button full className="mt-auto" variant="secondary" onClick={printReceipt}>Imprimir / Guardar PDF</Button>
          <p className="text-xs text-on-surface-soft">
            Al imprimir elige «Guardar como PDF» para compartirlo por WhatsApp. Solo el recibo sale en papel.
          </p>
        </div>
      </div>
    </Sheet>
    <OrderPaymentsSheet order={order} open={paymentsOpen} onClose={() => setPaymentsOpen(false)} />
    <IncidentSheet order={order} open={incidentOpen} onClose={() => setIncidentOpen(false)} />
    <DeliverySheet order={order} open={deliveryOpen} onClose={() => setDeliveryOpen(false)} />
    {packagingOpen && <PackagingSheet order={order} onClose={() => setPackagingOpen(false)} />}
    </>
  );
}
