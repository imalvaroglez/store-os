// #203 — the after-sales ficha: one incident per problem, linked to the
// order that sold the piece. Facts are registered as they happen (PO design:
// acciones directas, no cadena de estados obligatoria). Mobile-first, every
// action one tap away, errors explain themselves in Spanish.
import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  Money,
  SearchSelect,
  SelectField,
  Sheet,
  TextField,
  useToast,
} from "../../design-system";
import { orderItems } from "../../lib/orders";
import { uid } from "../../lib/ids";
import { orderAmountCents } from "../../lib/orderMoney";
import { incidentState, type IncidentPieceLocation } from "./incidents";
import { reconcileIncidentMoney } from "./incidentMoney";
import type { IncidentResolutionKind, Order, OrderIncident } from "../../types";

const PIECE_LABEL: Record<IncidentPieceLocation, string> = {
  with_customer: "Pieza con la clienta",
  quarantined: "En cuarentena (no vendible)",
  repaired_held: "Reparada — autoriza la venta para liberarla",
  back_in_stock: "De vuelta en inventario",
  written_off: "Dada de baja",
};

const RESOLUTION_LABEL: Record<IncidentResolutionKind, string> = {
  replacement_equivalent: "Reemplazo equivalente",
  replacement_with_difference: "Otra pieza con diferencia de precio",
  wait_restock: "Esperar reposición",
  refund: "Reembolso",
};

export function IncidentSheet({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const { state, activeStore, openIncident } = useStore();
  const toast = useToast();
  const items = useMemo(() => orderItems(order), [order]);
  const [lineId, setLineId] = useState<string>("");
  const [quantityText, setQuantityText] = useState("1");
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState(false);
  const [agreeingId, setAgreeingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const incidents = order.incidents ?? [];
  const products = activeStore
    ? state.products.filter((product) => product.storeId === activeStore.id).sort((a, b) => a.name.localeCompare(b.name, "es-MX"))
    : [];

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "No se pudo registrar. Intenta de nuevo.");
    }
  }

  async function submitOpen() {
    const item = items.find((candidate) => (candidate.lineId ?? "") === lineId) ?? items[0];
    if (!item) {
      toast.error("Elige la pieza con problema.");
      return;
    }
    const quantity = Math.round(Number(quantityText));
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > item.quantity) {
      toast.error(`La cantidad debe estar entre 1 y ${item.quantity}.`);
      return;
    }
    if (!reason.trim()) {
      toast.error("Escribe el motivo del problema.");
      return;
    }
    setOpening(true);
    await run(async () => {
      await openIncident(order, {
        id: uid("inc"),
        lineId: item.lineId,
        productId: item.productId,
        productName: item.productName,
        quantity,
        reason: reason.trim(),
        originalUnitPriceCents: orderAmountCents(item.unitPrice),
      });
      setLineId("");
      setQuantityText("1");
      setReason("");
    }, "Problema registrado.");
    setOpening(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Incidencia del pedido">
      <div className="space-y-4">
        {incidents.length === 0 && (
          <p className="text-sm text-on-surface-soft">
            Registra el problema apenas lo reporte la clienta: pieza, cantidad y motivo. Después acuerdas la solución y,
            cuando ocurra, confirmas la recepción de la pieza dañada junto con la entrega.
          </p>
        )}

        {incidents.map((incident) => (
          <IncidentCard
            key={incident.id}
            order={order}
            incident={incident}
            products={products}
            agreeing={agreeingId === incident.id}
            confirming={confirmingId === incident.id}
            onAgreeing={setAgreeingId}
            onConfirming={setConfirmingId}
            run={run}
          />
        ))}

        <Card className="space-y-3 !p-3">
          <h3 className="font-semibold text-ink">Registrar problema</h3>
          <SelectField
            label="Pieza"
            value={lineId || items[0]?.lineId || ""}
            onChange={setLineId}
            options={items.map((item) => ({
              value: item.lineId ?? "",
              label: `${item.quantity} × ${item.productName}`,
            }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Cantidad" inputMode="numeric" value={quantityText} onChange={(event) => setQuantityText(event.target.value)} />
            <TextField label="Motivo" placeholder="p. ej. piedra fallada" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <Button full disabled={opening} onClick={() => void submitOpen()}>
            {opening ? "Registrando…" : "Registrar problema"}
          </Button>
        </Card>
      </div>
    </Sheet>
  );
}

function IncidentCard({
  order,
  incident,
  products,
  agreeing,
  confirming,
  onAgreeing,
  onConfirming,
  run,
}: {
  order: Order;
  incident: OrderIncident;
  products: { id: string; name: string; sku?: string; quantityOnHand?: number; cost?: number; price?: number; prices?: Record<string, number> }[];
  agreeing: boolean;
  confirming: boolean;
  onAgreeing: (id: string | null) => void;
  onConfirming: (id: string | null) => void;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
}) {
  const { applyIncidentEvent } = useStore();
  const info = incidentState(incident);
  // #212 F6: the settle button only exists while money is actually pending
  // (executing at confirm already settles it once).
  const owedCents = typeof incident.resolution?.refundOwedCents === "number"
    ? Math.max(0, incident.resolution.refundOwedCents)
    : incident.resolution?.kind === "refund"
      ? Math.max(0, incident.resolution.refundUnitPriceCents ?? 0) * Math.max(1, incident.quantity)
      : 0;
  const refundStillPending = (incident.resolution?.kind === "refund" || (incident.resolution?.destination === "refund_pending" && (incident.resolution.refundOwedCents ?? 0) > 0))
    && owedCents > info.refundExecutedCents;
  const compensationDone = (incident.events ?? []).some((saved) => saved.kind === "provider_compensation");
  const [kind, setKind] = useState<IncidentResolutionKind>("replacement_equivalent");
  // r3: the clienta's explicit choice for money in her favor — required before
  // agreeing (the transaction rejects a missing destination server-side too).
  const [destination, setDestination] = useState<"refund_pending" | "credit_accepted" | "">("");
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacementPick, setReplacementPick] = useState<{ id: string; name: string; priceCents: number; costCents: number } | null>(null);
  const [chargeDifference, setChargeDifference] = useState(true);
  const [waitUntil, setWaitUntil] = useState("");
  const [dialog, setDialog] = useState<"confirm" | "none">("none");
  const [refundExecuted, setRefundExecuted] = useState(false);
  const [compensationText, setCompensationText] = useState("");

  // Money in the clienta's favor: a refund, or a cheaper replacement.
  const downgradeDifference = kind === "replacement_with_difference"
    && !!replacementPick && replacementPick.priceCents < incident.originalUnitPriceCents;
  const needsDestination = kind === "refund" || downgradeDifference;
  // ESTIMATE only — the transaction recomputes the authoritative amounts
  // against the fresh document when agreeing.
  const estimate = needsDestination
    ? reconcileIncidentMoney(order, {
        ...incident,
        resolution: { kind },
        ...(replacementPick && kind === "replacement_with_difference"
          ? { replacement: { productId: replacementPick.id, productName: replacementPick.name, unitPriceCents: replacementPick.priceCents, unitCostCents: replacementPick.costCents, chargeDifference: true } }
          : {}),
      })
    : null;

  async function agree() {
    onAgreeing(incident.id);
    // #212 F2: a replacement ALWAYS names the real piece leaving stock, with
    // its real stored cost — no invented figures, no stock-less defaults.
    const replacement = kind === "replacement_equivalent" || kind === "replacement_with_difference"
      ? (replacementPick
        ? { productId: replacementPick.id, productName: replacementPick.name, unitPriceCents: replacementPick.priceCents, unitCostCents: replacementPick.costCents, chargeDifference: kind === "replacement_with_difference" && chargeDifference }
        : undefined)
      : undefined;
    if ((kind === "replacement_equivalent" || kind === "replacement_with_difference") && !replacement) {
      onAgreeing(null);
      return; // the button is disabled; this guards programmatic calls
    }
    const resolution = kind === "wait_restock"
      ? { kind, waitUntil: waitUntil || undefined }
      : kind === "refund"
        ? { kind, destination: destination as "refund_pending" | "credit_accepted" }
        : kind === "replacement_with_difference" && downgradeDifference
          ? { kind, destination: destination as "refund_pending" | "credit_accepted" }
          : { kind };
    await run(
      () => applyIncidentEvent(order, incident.id, { id: uid("iev"), kind: "resolution_agreed" }, { resolution, replacement }),
      "Resolución acordada."
    );
    onAgreeing(null);
  }

  async function confirm() {
    setDialog("none");
    onConfirming(incident.id);
    const detail: Record<string, string | number> | undefined =
      info.resolution?.kind === "refund" && refundExecuted
        ? { refundExecutedCents: owedCents }
        : undefined;
    await run(
      () => applyIncidentEvent(order, incident.id, { id: uid("iev"), kind: "confirmed", ...(detail ? { detail } : {}) }),
      "Recepción y entrega registradas."
    );
    onConfirming(null);
  }

  async function later(kindLater: "repaired" | "provider_replacement" | "written_off" | "returned_to_sale" | "refund_executed" | "provider_compensation") {
    const detail: Record<string, string | number> | undefined =
      kindLater === "refund_executed"
        ? { refundExecutedCents: Math.max(0, owedCents - info.refundExecutedCents) }
        : kindLater === "provider_compensation" && compensationText.trim()
          ? { amountCents: orderAmountCents(Number(compensationText) || 0) }
          : undefined;
    await run(
      () => applyIncidentEvent(order, incident.id, { id: uid("iev"), kind: kindLater, ...(detail ? { detail } : {}) }),
      "Registrado."
    );
  }

  return (
    <Card className="space-y-3 !p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">
          {incident.quantity} × {incident.productName}
        </h3>
        <Badge tone={info.pieceLocation === "quarantined" ? "warning" : info.pieceLocation === "written_off" ? "neutral" : "info"}>
          {PIECE_LABEL[info.pieceLocation]}
        </Badge>
      </div>
      <p className="text-xs text-ink-soft">{incident.reason} · precio histórico <Money exact amount={incident.originalUnitPriceCents / 100} /></p>
      {info.resolution && (
        <p className="text-sm">
          {RESOLUTION_LABEL[info.resolution.kind]}
          {info.resolution.kind === "replacement_with_difference" && incident.replacement && (
            <>: {incident.replacement.productName} (<Money exact amount={incident.replacement.unitPriceCents / 100} />
            {incident.replacement.chargeDifference ? " · diferencia por cobrar" : " · diferencia absorbida"})</>
          )}
          {info.resolution.waitUntil && <> · acordado para {info.resolution.waitUntil}</>}
        </p>
      )}

      {!info.resolution && (
        <div className="space-y-3 border-t border-edge pt-3">
          <SelectField
            label="Solución acordada con la clienta"
            value={kind}
            onChange={(next) => setKind(next as IncidentResolutionKind)}
            options={(Object.keys(RESOLUTION_LABEL) as IncidentResolutionKind[]).map((value) => ({ value, label: RESOLUTION_LABEL[value] }))}
          />
          {(kind === "replacement_equivalent" || kind === "replacement_with_difference") && (
            <div className="space-y-2">
              <SearchSelect
                label="Pieza alternativa"
                value={replacementQuery}
                onChange={(value) => { setReplacementQuery(value); setReplacementPick(null); }}
                onSelect={(option) => {
                  const product = products.find((candidate) => candidate.id === option.value);
                  setReplacementQuery(option.label);
                  setReplacementPick({
                    id: option.value,
                    name: option.label,
                    priceCents: orderAmountCents(product?.price ?? Math.min(...Object.values(product?.prices ?? { base: 0 }).map(Number).filter((value) => Number.isFinite(value) && value >= 0))),
                    costCents: orderAmountCents(product?.cost ?? 0),
                  });
                }}
                options={products.map((product) => ({
                  value: product.id,
                  label: product.name,
                  detail: `Existencia: ${product.quantityOnHand ?? 0}`,
                  keywords: product.sku,
                }))}
                placeholder="Buscar por nombre o clave…"
              />
              <p className="text-xs text-on-surface-soft">El precio de la alternativa se captura al confirmar la diferencia con la clienta.</p>
              <CheckboxField
                label="Cobrar la diferencia a la clienta"
                caption="Si la absorbes como atención comercial, la venta no cambia."
                checked={chargeDifference}
                onChange={setChargeDifference}
              />
            </div>
          )}
          {kind === "wait_restock" && (
            <TextField label="Fecha acordada" type="date" value={waitUntil} onChange={(event) => setWaitUntil(event.target.value)} />
          )}
          {kind === "refund" && (
            <p className="text-sm text-on-surface-soft">
              Se devuelve <Money exact amount={(incident.originalUnitPriceCents * Math.max(1, incident.quantity)) / 100} /> a su precio
              histórico. La cantidad a devolver se concilia con lo que realmente pagó; queda pendiente (no se usa como saldo a favor) hasta que devuelvas el dinero.
            </p>
          )}
          {needsDestination && estimate && (
            <div className="space-y-2 rounded-xl bg-surface p-3 ring-1 ring-edge">
              <p className="text-sm">
                {estimate.saleAdjustmentCents < 0 && kind === "refund"
                  ? <>Venta ajustada −<Money exact amount={-estimate.saleAdjustmentCents / 100} /></>
                  : <>Diferencia a favor de la clienta <Money exact amount={estimate.reconciledCents / 100} /></>}
                {" "}· se le deben <strong><Money exact amount={estimate.reconciledCents / 100} /></strong>
                {estimate.restitutionCents > 0 && <> (de los cuales <Money exact amount={estimate.restitutionCents / 100} /> vuelven como crédito de su otro pedido)</>}
              </p>
              <p className="text-xs text-on-surface-soft">Elige con la clienta el destino (monto definitivo al guardar):</p>
              <div className="grid grid-cols-1 gap-2">
                <Button
                  variant={destination === "refund_pending" ? "primary" : "secondary"}
                  onClick={() => setDestination("refund_pending")}
                >
                  Reembolso pendiente ({estimate.refundOwedCents("refund_pending") > 0 ? <Money exact amount={estimate.refundOwedCents("refund_pending") / 100} /> : "sin efectivo"})
                </Button>
                <Button
                  variant={destination === "credit_accepted" ? "primary" : "secondary"}
                  onClick={() => setDestination("credit_accepted")}
                >
                  Crédito para sus pedidos (aceptado por la clienta)
                </Button>
              </div>
            </div>
          )}
          <Button
            full
            disabled={agreeing
              || ((kind === "replacement_equivalent" || kind === "replacement_with_difference") && !replacementPick)
              || (needsDestination && destination === "")}
            onClick={() => void agree()}
          >
            {agreeing ? "Guardando…" : "Acordar resolución"}
          </Button>
          {(kind === "replacement_equivalent" || kind === "replacement_with_difference") && !replacementPick && (
            <p className="text-xs text-on-surface-soft">Elige la pieza que entregas: sale de tu inventario con su costo real.</p>
          )}
        </div>
      )}

      {info.resolution && !info.confirmed && (
        <div className="space-y-2 border-t border-edge pt-3">
          <Button full variant="secondary" disabled={confirming} onClick={() => setDialog("confirm")}>
            Confirmar recepción de la pieza + entrega
          </Button>
          <p className="text-xs text-on-surface-soft">
            Se registra junto: la pieza dañada entra en cuarentena (no vendible) y la solución sale de inventario con su costo real.
          </p>
        </div>
      )}

      {info.confirmed && (info.pieceLocation === "quarantined" || info.pieceLocation === "repaired_held") && (
        <div className="flex flex-wrap gap-2 border-t border-edge pt-3">
          <Button size="sm" variant="secondary" onClick={() => void later("repaired")}>Reparado</Button>
          <Button size="sm" variant="secondary" onClick={() => void later("provider_replacement")}>Proveedor entregó reemplazo</Button>
          <Button size="sm" variant="secondary" onClick={() => void later("written_off")}>Dar de baja</Button>
          <Button size="sm" variant="ghost" onClick={() => void later("returned_to_sale")}>Volver a venta</Button>
        </div>
      )}
      {info.confirmed && incident.resolution?.kind === "refund" && refundStillPending && (
        <div className="border-t border-edge pt-3">
          <Button size="sm" variant="secondary" onClick={() => void later("refund_executed")}>Devolví el dinero</Button>
        </div>
      )}
      {info.confirmed && !compensationDone && (
        <div className="border-t border-edge pt-3">
          <TextField
            label="Compensación recibida del proveedor (opcional)"
            inputMode="decimal"
            placeholder="0.00"
            value={compensationText}
            onChange={(event) => setCompensationText(event.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={!compensationText.trim() || compensationDone}
            onClick={() => void later("provider_compensation").then(() => setCompensationText(""))}
          >
            {compensationDone ? "Compensación registrada" : "Registrar compensación"}
          </Button>
        </div>
      )}

      <Dialog
        open={dialog === "confirm"}
        title="Confirmar recepción y entrega"
        onClose={() => setDialog("none")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog("none")}>Cancelar</Button>
            <Button onClick={() => void confirm()}>Confirmar</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Confirma sólo cuando ya ocurrió: recibiste la pieza dañada de {incident.productName}
          {info.resolution?.kind === "refund"
            ? " y entregaste el reembolso."
            : info.resolution?.kind === "wait_restock"
              ? " y entregaste la reposición."
              : " y entregaste el reemplazo."}
        </p>
        {info.resolution?.kind === "refund" && (
          <CheckboxField
            label="Ya devolví el dinero a la clienta"
            checked={refundExecuted}
            onChange={setRefundExecuted}
          />
        )}
      </Dialog>
    </Card>
  );
}
