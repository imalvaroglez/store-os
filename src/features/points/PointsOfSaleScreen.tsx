// #524 — Ventas → Puntos de venta (first verifiable UI cut): list the
// store's points with their live pieces/valuation, create a point, and give
// an EMPTY ficha its first surtido via «Usar como surtido inicial» — the
// preview shows destination, physical date, pieces/variants and marked
// prices (from the order, exact cents), and the TRUSTED callable does the
// whole movement in one transaction. Cortes/cobros/anulación and manual
// Surtir/Retirar arrive in later cuts.
import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Money,
  Screen,
  ScreenHeader,
  TextField,
  useToast,
} from "../../design-system";
import { slugify } from "../../lib/catalog";
import { todayIso } from "../../lib/dates";
import { formatMoneyExact } from "../../lib/money";
import { REGULAR_TIER_ID, tiersForStore } from "../../lib/pricing";

/** Cents → pesos for the Money component (whole-peso rounding, exact cents kept). */
const pesos = (cents: number): number => Math.round(cents) / 100;
import { uid } from "../../lib/ids";
import { orderReference } from "../../lib/orders";
import {
  buildFirstSurtidoFromOrder,
  orderConversionImpediments,
  pointSummaries,
} from "../../lib/pointOfSale";
import type { Order, PointOfSale } from "../../types";

/** A real calendar date (YYYY-MM-DD), semantics checked before confirming. */
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(text: string): boolean {
  if (!VALID_DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function PointsOfSaleScreen() {
  const { state, activeStore, savePoint, convertOrderToFirstSurtido } = useStore();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [openPointId, setOpenPointId] = useState<string | null>(null);
  const [surtidoOrder, setSurtidoOrder] = useState<Order | null>(null);
  const [pickingOrder, setPickingOrder] = useState(false);
  const [physicalDate, setPhysicalDate] = useState(todayIso());

  const storeId = activeStore?.id ?? "";
  const points = useMemo(
    () => state.points.filter((p) => p.storeId === storeId && p.active),
    [state.points, storeId]
  );
  const summaries = useMemo(
    () => pointSummaries(state.pointEntries.filter((e) => e.storeId === storeId)),
    [state.pointEntries, storeId]
  );

  const openPoint = points.find((p) => p.id === openPointId) ?? null;
  const pointEntries = useMemo(
    () =>
      openPoint
        ? state.pointEntries
            .filter((e) => e.pointId === openPoint.id)
            .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt))
        : [],
    [state.pointEntries, openPoint]
  );

  if (activeStore?.type !== "inventory_tiered") {
    return (
      <Screen>
        <ScreenHeader title="Puntos de venta" subtitle="Mercancía exhibida en mostradores y vitrinas" />
        <EmptyState
          title="Los puntos de venta usan el inventario de tu tienda"
          subtitle="Esta tienda trabaja bajo pedido, sin existencias. Los puntos de venta están disponibles para tiendas de inventario y precios."
        />
      </Screen>
    );
  }

  async function createPoint() {
    const clean = name.trim();
    if (!clean || !storeId) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const point: PointOfSale = {
        id: `${storeId}__${slugify(clean) || uid()}`,
        storeId,
        name: clean,
        // Pilot defaults (issue #524): Regular level and 20% commission,
        // confirmed per corte; editable in a later settings cut. Canonical
        // fallback keeps "Regular" even when the store never saved tiers.
        priceTierId: tiersForStore(activeStore).find((t) => t.id === REGULAR_TIER_ID)?.id,
        commissionRate: 0.2,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      await savePoint(point);
      toast.success(`Punto «${clean}» creado.`);
      setCreating(false);
      setName("");
      setOpenPointId(point.id);
    } catch {
      toast.error("No se pudo crear el punto de venta. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const [orderQuery, setOrderQuery] = useState("");
  // #524 review (Mayor 1): candidates are the OPEN confirmed orders, newest
  // first, with a search — never an arbitrary cap over a set that grows with
  // every conversion (the 1.11.0 class of defect).
  const candidateOrders = useMemo(() => {
    if (surtidoOrder !== null || !openPoint) return [];
    const needle = orderQuery.trim().toLowerCase();
    return state.orders
      .filter((o) => o.storeId === storeId && o.orderStatus === "confirmed" && !o.convertedToPointId)
      .filter(
        (o) =>
          needle === "" ||
          (o.customerName ?? "").toLowerCase().includes(needle) ||
          orderReference(o.id).toLowerCase().includes(needle)
      )
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [surtidoOrder, openPoint, state.orders, storeId, orderQuery]);

  // One intent per (order, dialog) selection: a retry after a lost response
  // keeps the SAME id so the callable can answer alreadyConverted instead of
  // bouncing with "ya fue convertido".
  const [intentId, setIntentId] = useState("");
  const previewEntries = useMemo(
    () =>
      surtidoOrder && openPoint
        ? buildFirstSurtidoFromOrder(surtidoOrder, state.products.filter((p) => p.storeId === storeId), physicalDate)
        : [],
    [surtidoOrder, openPoint, state.products, storeId, physicalDate]
  );

  async function confirmConversion() {
    if (!surtidoOrder || !openPoint) return;
    // Concurrent surtido guard: if entries arrived meanwhile (another tab or
    // operadora), stop and say so — never stack two "first" surtidos.
    if (state.pointEntries.some((e) => e.pointId === openPoint.id)) {
      toast.error("Este punto ya recibió mercancía mientras revisabas; revisa su ficha.");
      setSurtidoOrder(null);
      setPickingOrder(false);
      return;
    }
    if (!isRealDate(physicalDate)) {
      toast.error("La fecha física de entrega no es una fecha real.");
      return;
    }
    setBusy(true);
    try {
      const result = await convertOrderToFirstSurtido({
        storeId,
        pointId: openPoint.id,
        orderId: surtidoOrder.id,
        physicalDate,
        intentId,
      });
      toast.success(
        result.converted
          ? `Surtido inicial listo: ${result.entryCount} entradas, ${result.units} piezas en ${openPoint.name}.`
          : "Este pedido ya estaba convertido; no se hizo ningún cambio."
      );
      setSurtidoOrder(null);
      setPickingOrder(false);
    } catch (error) {
      // The callable re-validates authoritatively; its Spanish message names
      // the real impediment — surface it, never fake a success.
      toast.error(error instanceof Error ? error.message : "No se pudo convertir el pedido.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Puntos de venta"
        subtitle="Mercancía que exhibes en mostradores y vitrinas — sigue siendo tuya hasta que se vende"
        action={<Button size="sm" onClick={() => setCreating(true)}>+ Nuevo punto</Button>}
      />
      <div className="space-y-4">
        {points.length === 0 ? (
          <EmptyState
            title="Aún no tienes puntos de venta"
            subtitle="Un punto de venta es un mostrador o vitrina donde dejas mercancía. Crea el primero y dale su surtido inicial."
            action={<Button onClick={() => setCreating(true)}>Crear el primer punto</Button>}
          />
        ) : (
          points.map((point) => {
            const summary = summaries.get(point.id);
            return (
              <Card key={point.id} className="space-y-2">
                <Button
                  variant="ghost"
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                  onClick={() => setOpenPointId(point.id === openPointId ? null : point.id)}
                >
                  <span className="font-semibold text-ink">{point.name}</span>
                  <span className="text-sm text-on-surface-soft">
                    {summary ? `${summary.units} piezas` : "Sin mercancía"}
                  </span>
                </Button>
                {summary ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p className="text-on-surface-soft">
                      Valor al precio marcado: <span className="font-semibold text-on-surface"><Money exact amount={pesos(summary.markedValueCents)} /></span>
                    </p>
                    <p className="text-on-surface-soft">
                      Valor al costo: <span className="font-semibold text-on-surface"><Money exact amount={pesos(summary.costValueCents)} /></span>
                      {summary.pendingCostUnits > 0 ? ` (${summary.pendingCostUnits} con costo pendiente)` : ""}
                    </p>
                  </div>
                ) : null}
              </Card>
            );
          })
        )}

        {openPoint ? (
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-ink">{openPoint.name}</h3>
              <Badge>{(() => { const oldest = summaries.get(openPoint.id)?.oldestEntryDate; return oldest ? `Pieza más antigua desde el ${oldest}` : "Ficha"; })()}</Badge>
            </div>
            {pointEntries.length === 0 ? (
              <EmptyState
                title="Este punto todavía no tiene mercancía"
                subtitle="Dale su primer surtido desde un pedido confirmado: las piezas reservadas pasan al punto con su precio y su costo."
                action={
                  <Button
                    onClick={() => {
                      setSurtidoOrder(null);
                      setPhysicalDate(todayIso());
                      setPickingOrder(true);
                    }}
                  >
                    Usar como surtido inicial
                  </Button>
                }
              />
            ) : (
              <div className="space-y-1">
                {pointEntries.map((entry) => {
                  const left = Math.max(0, entry.quantity - entry.consumedQty);
                  return (
                    <div key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-1 text-sm last:border-0">
                      <span className="min-w-0 flex-1 truncate">
                        {entry.productName}
                        {entry.variantColor ? ` · ${entry.variantColor}` : ""}
                      </span>
                      <span className="text-on-surface-soft">{left} de {entry.quantity} · {entry.entryDate}</span>
                      <span className="font-semibold text-on-surface"><Money exact amount={pesos(entry.markedPriceCents)} /></span>
                      <span className="text-on-surface-soft">
                        {entry.unitCostCents !== undefined ? `costo ${formatMoneyExact(pesos(entry.unitCostCents))}` : "costo pendiente"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        ) : null}
      </div>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Nuevo punto de venta"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button disabled={busy || !name.trim()} onClick={() => void createPoint()}>Crear punto</Button>
          </>
        }
      >
        <TextField label="Nombre del punto" placeholder="Mostrador centro, vitrina plaza…" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-xs text-on-surface-soft">
          Para el piloto, el punto vende al nivel Regular y sugiere una comisión del 20%; se confirman en cada corte.
        </p>
      </Dialog>

      <Dialog
        open={pickingOrder && !!openPoint && surtidoOrder === null && pointEntries.length === 0}
        onClose={() => setPickingOrder(false)}
        title="Usar como surtido inicial"
      >
        <p className="text-sm text-on-surface-soft">
          Elige un pedido confirmado sin cobros: sus piezas reservadas pasan a este punto con el precio y el costo que ya trae.
        </p>
        <TextField
          label="Buscar"
          placeholder="Clienta o referencia…"
          value={orderQuery}
          onChange={(e) => setOrderQuery(e.target.value)}
        />
        <p className="text-xs text-on-surface-soft">{candidateOrders.length} pedido(s) confirmado(s) abierto(s)</p>
        <div className="space-y-1">
          {candidateOrders.length === 0 ? (
            <p className="text-sm text-on-surface-soft">No hay pedidos confirmados disponibles.</p>
          ) : (
            candidateOrders.map((order) => {
              const check = orderConversionImpediments(order, state.products.filter((p) => p.storeId === storeId));
              return (
                <Button
                  key={order.id}
                  variant="ghost"
                  disabled={!check.canConvert}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left text-sm"
                  onClick={() => {
                    setIntentId(uid());
                    setSurtidoOrder(order);
                  }}
                >
                  <span className="font-medium text-on-surface">
                    {orderReference(order.id)} · {order.customerName ?? "clienta"}
                  </span>
                  <span className="text-xs text-on-surface-soft">
                    {order.convertedToPointId
                      ? "Ya convertido"
                      : check.canConvert
                        ? "Listo para surtir"
                        : (check.reasons[0] ?? check.lineIssues[0]?.reason ?? "No elegible")}
                  </span>
                </Button>
              );
            })
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!surtidoOrder}
        onClose={() => setSurtidoOrder(null)}
        title="Vista previa del surtido inicial"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSurtidoOrder(null)}>Cancelar</Button>
            <Button disabled={busy || previewEntries.length === 0 || !isRealDate(physicalDate)} onClick={() => void confirmConversion()}>
              Surtir {previewEntries.reduce((sum, e) => sum + e.quantity, 0)} piezas
            </Button>
          </>
        }
      >
        {surtidoOrder && openPoint ? (
          <div className="space-y-3">
            <TextField label="Fecha física de entrega" inputMode="numeric" placeholder="AAAA-MM-DD" value={physicalDate} onChange={(e) => setPhysicalDate(e.target.value)} />
            <p className="text-sm text-on-surface-soft">
              Destino: <span className="font-semibold text-on-surface">{openPoint.name}</span> · pedido {orderReference(surtidoOrder.id)}.
              El pedido deja de contar como comprometido y por cobrar; el almacén no vuelve a descontar.
            </p>
            <div className="space-y-1">
              {previewEntries.map((entry, index) => (
                <div key={index} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-1 text-sm last:border-0">
                  <span className="min-w-0 flex-1 truncate">
                    {entry.productName}
                    {entry.variantColor ? ` · ${entry.variantColor}` : ""}
                  </span>
                  <span className="text-on-surface-soft">{entry.quantity} pzas</span>
                  <span className="font-semibold text-on-surface"><Money exact amount={pesos(entry.markedPriceCents)} /></span>
                  <span className="text-on-surface-soft">
                    {entry.unitCostCents !== undefined ? `costo ${formatMoneyExact(pesos(entry.unitCostCents))}` : "costo pendiente"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Dialog>
    </Screen>
  );
}
