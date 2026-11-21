// #524 — Ventas → Puntos de venta (first verifiable UI cut): list the
// store's points with their live pieces/valuation, create a point, and give
// an EMPTY ficha its first surtido via «Usar como surtido inicial» — the
// preview shows destination, physical date, pieces/variants and marked
// prices (from the order, exact cents), and the TRUSTED callable does the
// whole movement in one transaction. Cortes/cobros/anulación and manual
// Surtir/Retirar arrive in later cuts.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  EmptyState,
  Money,
  Screen,
  ScreenHeader,
  SelectField,
  TextField,
  useToast,
} from "../../design-system";
import { slugify } from "../../lib/catalog";
import { loadClosesForStore } from "../../app/firebase/firestoreData";
import { formatDate, todayIso } from "../../lib/dates";
import { orderTotals } from "../../lib/orders";
import { formatMoneyExact, parseAmount } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { REGULAR_TIER_ID, tiersForStore } from "../../lib/pricing";

/** Does any sellable row still have pieces? (drives «Registrar corte»). */
function summaryHasStock(rows: Array<{ left: number }>): boolean {
  return rows.some((row) => row.left > 0);
}

/** Cents → pesos for the Money component (whole-peso rounding, exact cents kept). */
const pesos = (cents: number): number => Math.round(cents) / 100;
import { uid } from "../../lib/ids";
import { orderReference } from "../../lib/orders";
import {
  buildFirstSurtidoFromOrder,
  orderConversionImpediments,
  planCorte,
  pointSummaries,
} from "../../lib/pointOfSale";
import type { Order, PointEntry, PointOfSale } from "../../types";

/** A real calendar date (YYYY-MM-DD), semantics checked before confirming. */
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(text: string): boolean {
  if (!VALID_DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function PointsOfSaleScreen() {
  const { state, activeStore, savePoint, convertOrderToFirstSurtido, registerPointCut, registerPointCutPayment, stockPoint, withdrawFromPoint, annulPointCut } = useStore();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [openPointId, setOpenPointId] = useState<string | null>(null);
  const [surtidoOrder, setSurtidoOrder] = useState<Order | null>(null);
  const [pickingOrder, setPickingOrder] = useState(false);
  const [physicalDate, setPhysicalDate] = useState(todayIso());
  // #524 corte capture: per-row sold quantities, write-off rows, live plan.
  const [cutOpen, setCutOpen] = useState(false);
  const [soldByRow, setSoldByRow] = useState<Record<string, string>>({});
  const [cutQuery, setCutQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [cutDate, setCutDate] = useState(todayIso());
  const [commissionPct, setCommissionPct] = useState<string>("");
  const [bajas, setBajas] = useState<Array<{ rowKey: string; qty: string; reason: string }>>([]);
  const [payingCorte, setPayingCorte] = useState<string | null>(null);
  // #524 manual movements: warehouse → point (stocking) and point → warehouse.
  const [stocking, setStocking] = useState(false);
  const [stockQuery, setStockQuery] = useState("");
  const [stockQty, setStockQty] = useState<Record<string, string>>({});
  const [stockPrice, setStockPrice] = useState<Record<string, string>>({});
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawQty, setWithdrawQty] = useState<Record<string, string>>({});
  // #524 annulment: the latest unpaid corte, with the open-month check.
  const [annulling, setAnnulling] = useState<string | null>(null);
  const [annulMotive, setAnnulMotive] = useState("");
  const [sealedPeriods, setSealedPeriods] = useState<Set<string>>(new Set());
  const [payDate, setPayDate] = useState(todayIso());
  const [payMethod, setPayMethod] = useState<"cash" | "transfer">("cash");

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

  // #524 corte capture rows: one sellable row per product + color + marked
  // price with pieces remaining (coexisting prices stay separate rows so the
  // operator sells at the price she actually charged).
  const cutRows = useMemo(() => {
    const byKey = new Map<string, { key: string; entry: PointEntry; label: string; left: number }>();
    for (const entry of pointEntries) {
      const left = Math.max(0, entry.quantity - entry.consumedQty);
      if (left <= 0) continue;
      const key = `${entry.productId}|${entry.variantId ?? ""}|${entry.markedPriceCents}`;
      const existing = byKey.get(key);
      if (existing) existing.left += left;
      else
        byKey.set(key, {
          key,
          entry,
          label: `${entry.productName}${entry.variantColor ? ` · ${entry.variantColor}` : ""}`,
          left,
        });
    }
    return [...byKey.values()];
  }, [pointEntries]);

  const effectiveCommission = useMemo(() => {
    // An EMPTY field is "use the point's suggestion" — Number("") === 0, so
    // parse only real input (#524: the rate is confirmed per corte).
    const text = commissionPct.trim();
    if (text !== "") {
      const pct = Number(text.replace(",", "."));
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct / 100;
    }
    return openPoint?.commissionRate ?? 0.2;
  }, [commissionPct, openPoint?.commissionRate]);

  const cutPlan = useMemo(() => {
    if (!cutOpen) return null;
    const lines = cutRows
      .map((row) => ({ row, sold: Number(soldByRow[row.key] ?? "") }))
      .filter((item) => Number.isFinite(item.sold) && item.sold > 0)
      .map((item) => ({
        productId: item.row.entry.productId,
        ...(item.row.entry.variantId ? { variantId: item.row.entry.variantId } : {}),
        markedPriceCents: item.row.entry.markedPriceCents,
        soldQty: Math.floor(item.sold),
      }));
    const writeOffs = bajas
      .map((baja) => {
        const row = cutRows.find((candidate) => candidate.key === baja.rowKey);
        const qty = Number(baja.qty);
        if (!row || !Number.isFinite(qty) || qty <= 0 || !baja.reason.trim()) return null;
        return {
          productId: row.entry.productId,
          ...(row.entry.variantId ? { variantId: row.entry.variantId } : {}),
          markedPriceCents: row.entry.markedPriceCents,
          qty: Math.floor(qty),
          reason: baja.reason.trim(),
        };
      })
      .filter((writeOff): writeOff is NonNullable<typeof writeOff> => writeOff !== null);
    return planCorte(pointEntries, lines, writeOffs, effectiveCommission);
  }, [cutOpen, cutRows, soldByRow, bajas, pointEntries, effectiveCommission]);

  const cutHasInput = useMemo(
    () => Object.values(soldByRow).some((value) => Number(value) > 0) || bajas.some((baja) => Number(baja.qty) > 0),
    [soldByRow, bajas]
  );

  // Warehouse rows for «Surtir del almacén»: sellable shelf per product or
  // color, with the point's tier price proposed (pilot: Regular).
  const tierId = openPoint?.priceTierId ?? activeStore?.defaultTierId ?? "t_retail";
  const warehouseRows = useMemo(() => {
    if (!stocking) return [];
    const rows: Array<{ key: string; productId: string; variantId?: string; label: string; available: number; suggestedPrice: number; cost?: number }> = [];
    for (const product of state.products.filter((p) => p.storeId === storeId)) {
      const variants = product.variants ?? [];
      if (variants.length > 0) {
        for (const variant of variants) {
          const available = variant.quantityOnHand ?? 0;
          if (available <= 0) continue;
          rows.push({
            key: `${product.id}|${variant.id}`,
            productId: product.id,
            variantId: variant.id,
            label: `${product.name} · ${variant.color}`,
            available,
            suggestedPrice: product.prices?.[tierId] ?? 0,
            cost: variant.cost ?? product.cost,
          });
        }
      } else {
        const available = product.quantityOnHand ?? 0;
        if (available <= 0) continue;
        rows.push({
          key: `${product.id}|`,
          productId: product.id,
          label: product.name,
          available,
          suggestedPrice: product.prices?.[tierId] ?? 0,
          cost: product.cost,
        });
      }
    }
    const needle = stockQuery.trim().toLowerCase();
    return needle === "" ? rows : rows.filter((row) => row.label.toLowerCase().includes(needle));
  }, [stocking, state.products, storeId, tierId, stockQuery]);

  // Point rows for «Retirar»: per product + color (any price), pieces left.
  const withdrawRows = useMemo(() => {
    if (!withdrawing) return [];
    const byDimension = new Map<string, { key: string; productId: string; variantId?: string; label: string; left: number }>();
    for (const row of cutRows) {
      const key = `${row.entry.productId}|${row.entry.variantId ?? ""}`;
      const existing = byDimension.get(key);
      if (existing) existing.left += row.left;
      else
        byDimension.set(key, {
          key,
          productId: row.entry.productId,
          ...(row.entry.variantId ? { variantId: row.entry.variantId } : {}),
          label: row.label,
          left: row.left,
        });
    }
    return [...byDimension.values()];
  }, [withdrawing, cutRows]);

  const pointOperations = useMemo(
    () =>
      openPoint
        ? state.pointOperations
            .filter((op) => op.pointId === openPoint.id)
            .sort((a, b) => (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? ""))
        : [],
    [state.pointOperations, openPoint]
  );
  const pendingCortes = pointOperations.filter((op) => op.kind === "corte" && op.status === "pendiente_de_cobro");
  // #524: annulment applies to the LATEST corte still without cobro; a month
  // with an AUTHORIZED close is history — the adjustments review owns it.
  const latestUnpaidCorte =
    pointOperations.find((op) => op.kind === "corte" && (op.status === "pendiente_de_cobro" || op.status === "sin_cobro")) ?? null;
  useEffect(() => {
    if (!openPoint || !storeId) return;
    let alive = true;
    loadClosesForStore(storeId)
      .then((snapshots) => {
        if (alive) setSealedPeriods(new Set(snapshots.map((snapshot) => snapshot.period)));
      })
      .catch(() => {
        if (alive) setSealedPeriods(new Set());
      });
    return () => {
      alive = false;
    };
  }, [openPoint, storeId]);
  const annulTarget = pointOperations.find((op) => op.id === annulling) ?? null;
  const annulMonthSealed = annulTarget?.effectiveDate ? sealedPeriods.has(annulTarget.effectiveDate.slice(0, 7)) : false;
  const payingCorteOp = pointOperations.find((op) => op.id === payingCorte) ?? null;

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

  async function confirmCut() {
    if (!openPoint || !cutPlan || cutPlan.errors.length > 0) return;
    setBusy(true);
    try {
      const lines = cutRows
        .map((row) => ({ row, sold: Number(soldByRow[row.key] ?? "") }))
        .filter((item) => Number.isFinite(item.sold) && item.sold > 0)
        .map((item) => ({
          productId: item.row.entry.productId,
          ...(item.row.entry.variantId ? { variantId: item.row.entry.variantId } : {}),
          markedPriceCents: item.row.entry.markedPriceCents,
          soldQty: Math.floor(item.sold),
        }));
      const writeOffs = bajas
        .map((baja) => {
          const row = cutRows.find((candidate) => candidate.key === baja.rowKey);
          const qty = Number(baja.qty);
          if (!row || !Number.isFinite(qty) || qty <= 0 || !baja.reason.trim()) return null;
          return {
            productId: row.entry.productId,
            ...(row.entry.variantId ? { variantId: row.entry.variantId } : {}),
            markedPriceCents: row.entry.markedPriceCents,
            qty: Math.floor(qty),
            reason: baja.reason.trim(),
          };
        })
        .filter((writeOff): writeOff is NonNullable<typeof writeOff> => writeOff !== null);
      const result = await registerPointCut({
        storeId,
        pointId: openPoint.id,
        intentId: uid(),
        effectiveDate: cutDate,
        commissionRate: effectiveCommission,
        lines,
        writeOffs,
      });
      const net = result.totals?.netCents;
      toast.success(
        result.registered
          ? typeof net === "number" && net > 0
            ? `Corte registrado. Neto por cobrar: ${formatMoneyExact(pesos(net))}.`
            : "Corte registrado sin cobro pendiente."
          : "Este corte ya estaba registrado; no se hizo ningún cambio."
      );
      setCutOpen(false);
      setSoldByRow({});
      setBajas([]);
      setCommissionPct("");
      setCutDate(todayIso());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el corte.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPay() {
    if (!openPoint || !payingCorteOp) return;
    setBusy(true);
    try {
      const result = await registerPointCutPayment({
        storeId,
        pointId: openPoint.id,
        corteId: payingCorteOp.id,
        intentId: uid(),
        method: payMethod,
        date: payDate,
      });
      toast.success(
        result.registered
          ? `Cobro registrado: ${formatMoneyExact(pesos(result.amountCents ?? 0))} (${payMethod === "cash" ? "efectivo" : "transferencia"}).`
          : "Este cobro ya estaba registrado; no se hizo ningún cambio."
      );
      setPayingCorte(null);
      setPayDate(todayIso());
      setPayMethod("cash");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el cobro.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmStock() {
    if (!openPoint) return;
    const lines = warehouseRows
      .map((row) => ({ row, qty: Number(stockQty[row.key] ?? "") }))
      .filter((item) => Number.isFinite(item.qty) && item.qty > 0 && item.qty <= item.row.available)
      .map((item) => {
        const priceText = stockPrice[item.row.key]?.trim();
        const price = priceText !== undefined && priceText !== "" ? parseAmount(priceText) : undefined;
        return {
          productId: item.row.productId,
          ...(item.row.variantId ? { variantId: item.row.variantId } : {}),
          qty: Math.floor(item.qty),
          markedPriceCents: orderAmountCents(price ?? item.row.suggestedPrice, 1),
        };
      });
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const result = await stockPoint({
        storeId,
        pointId: openPoint.id,
        physicalDate: todayIso(),
        lines,
      });
      toast.success(
        result.stocked
          ? `Surtido: ${result.units} piezas al punto.`
          : "Este surtido ya estaba aplicado; no se hizo ningún cambio."
      );
      setStocking(false);
      setStockQty({});
      setStockPrice({});
      setStockQuery("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo surtir el punto.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithdraw() {
    if (!openPoint) return;
    const lines = withdrawRows
      .map((row) => ({ row, qty: Number(withdrawQty[row.key] ?? "") }))
      .filter((item) => Number.isFinite(item.qty) && item.qty > 0 && item.qty <= item.row.left)
      .map((item) => ({
        productId: item.row.productId,
        ...(item.row.variantId ? { variantId: item.row.variantId } : {}),
        qty: Math.floor(item.qty),
      }));
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const result = await withdrawFromPoint({ storeId, pointId: openPoint.id, lines });
      toast.success(
        result.withdrawn
          ? `Retiro: ${result.units} piezas de vuelta al almacén.`
          : "Este retiro ya estaba aplicado; no se hizo ningún cambio."
      );
      setWithdrawing(false);
      setWithdrawQty({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo retirar la mercancía.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAnnul() {
    if (!openPoint || !annulTarget || !annulMotive.trim()) return;
    setBusy(true);
    try {
      const result = await annulPointCut({
        storeId,
        pointId: openPoint.id,
        corteId: annulTarget.id,
        intentId: uid(),
        motive: annulMotive.trim(),
      });
      toast.success(result.registered ? "Corte anulado: las piezas vuelven al punto." : "Este corte ya estaba anulado.");
      setAnnulling(null);
      setAnnulMotive("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo anular el corte.");
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
              <Badge>{(() => { const oldest = summaries.get(openPoint.id)?.oldestEntryDate; return oldest ? `Pieza más antigua desde el ${formatDate(oldest)}` : "Ficha"; })()}</Badge>
            </div>
            {openPoint ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setStocking(true); setStockQuery(""); }}>
                  Surtir del almacén
                </Button>
                {summaryHasStock(cutRows) ? (
                  <Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)}>
                    Retirar
                  </Button>
                ) : null}
                {latestUnpaidCorte ? (
                  <Button variant="ghost" size="sm" onClick={() => { setAnnulling(latestUnpaidCorte.id); setAnnulMotive(""); }}>
                    Anular corte
                  </Button>
                ) : null}
              </div>
            ) : null}

            {pointEntries.length > 0 && summaryHasStock(cutRows) ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setCutOpen((value) => !value);
                  setCutDate(todayIso());
                }}
              >
                {cutOpen ? "Cerrar captura" : "Registrar corte"}
              </Button>
            ) : null}

            {pendingCortes.length > 0 ? (
              <div className="space-y-2 rounded-xl bg-surface p-3 ring-1 ring-edge">
                <p className="text-sm font-semibold text-on-surface">Cortes por cobrar</p>
                {pendingCortes.map((corte) => (
                  <div key={corte.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="text-on-surface-soft">
                      {formatDate(corte.effectiveDate ?? "")} · neto{" "}
                      <span className="font-semibold text-on-surface"><Money exact amount={pesos(corte.totals?.netCents ?? 0)} /></span>
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPayingCorte(corte.id);
                        setPayDate(todayIso());
                      }}
                    >
                      Registrar cobro
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {cutOpen ? (
              <div className="space-y-3 rounded-xl bg-surface p-3 ring-1 ring-edge">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <TextField
                    label="Buscar"
                    placeholder="Nombre o clave…"
                    value={cutQuery}
                    onChange={(e) => setCutQuery(e.target.value)}
                  />
                  <TextField
                    label="Fecha efectiva"
                    inputMode="numeric"
                    placeholder="AAAA-MM-DD"
                    value={cutDate}
                    onChange={(e) => setCutDate(e.target.value)}
                  />
                  <TextField
                    label="Comisión (%)"
                    inputMode="decimal"
                    placeholder={`${Math.round(effectiveCommission * 100)}`}
                    value={commissionPct}
                    onChange={(e) => setCommissionPct(e.target.value)}
                  />
                </div>
                <CheckboxField
                  label="Ver sólo filas con cambios"
                  checked={onlyChanged}
                  onChange={(checked) => setOnlyChanged(checked)}
                />
                <div className="space-y-1">
                  {cutRows
                    .filter((row) => {
                      if (onlyChanged && !(Number(soldByRow[row.key] ?? "") > 0)) return false;
                      const needle = cutQuery.trim().toLowerCase();
                      if (!needle) return true;
                      return (
                        row.label.toLowerCase().includes(needle) ||
                        (row.entry.productName.toLowerCase().includes(needle))
                      );
                    })
                    .map((row) => (
                      <div key={row.key} className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-1 last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-on-surface">{row.label}</p>
                          <p className="text-xs text-on-surface-soft">
                            {row.left} disponibles · <Money exact amount={pesos(row.entry.markedPriceCents)} />
                          </p>
                        </div>
                        <div className="w-28">
                          <TextField
                            label="Vendidas"
                            inputMode="numeric"
                            placeholder="0"
                            value={soldByRow[row.key] ?? ""}
                            onChange={(e) => setSoldByRow((prev) => ({ ...prev, [row.key]: e.target.value }))}
                          />
                        </div>
                      </div>
                    ))}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-on-surface">Bajas (daño o pérdida)</p>
                  {bajas.map((baja, index) => {
                    return (
                      <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_1fr_auto] sm:items-end">
                        <SelectField
                          label="Pieza"
                          value={baja.rowKey}
                          onChange={(value) =>
                            setBajas((prev) => prev.map((item, i) => (i === index ? { ...item, rowKey: value } : item)))
                          }
                          options={cutRows.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
                        />
                        <TextField
                          label="Cantidad"
                          inputMode="numeric"
                          placeholder="0"
                          value={baja.qty}
                          onChange={(e) => setBajas((prev) => prev.map((item, i) => (i === index ? { ...item, qty: e.target.value } : item)))}
                        />
                        <TextField
                          label="Motivo"
                          placeholder="p. ej. dañada en mostrador"
                          value={baja.reason}
                          onChange={(e) => setBajas((prev) => prev.map((item, i) => (i === index ? { ...item, reason: e.target.value } : item)))}
                        />
                        <Button variant="ghost" onClick={() => setBajas((prev) => prev.filter((_, i) => i !== index))}>
                          Quitar
                        </Button>
                      </div>
                    );
                  })}
                  <Button variant="ghost" size="sm" onClick={() => setBajas((prev) => [...prev, { rowKey: cutRows[0]?.key ?? "", qty: "", reason: "" }])}>
                    + Agregar baja
                  </Button>
                </div>

                {cutPlan ? (
                  <div className="space-y-1 rounded-xl bg-paper p-3 ring-1 ring-edge text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-on-surface-soft">Venta bruta</span>
                      <span className="font-semibold text-on-surface"><Money exact amount={pesos(cutPlan.totals.grossSaleCents)} /></span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-on-surface-soft">Comisión ({Math.round(effectiveCommission * 100)}%)</span>
                      <span className="font-semibold text-on-surface"><Money exact amount={pesos(cutPlan.totals.commissionCents)} /></span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-on-surface-soft">Neto a cobrar</span>
                      <span className="font-semibold text-on-surface"><Money exact amount={pesos(cutPlan.totals.netCents)} /></span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-on-surface-soft">
                        Resultado del corte
                        {cutPlan.totals.resultCents === null ? " (costo pendiente)" : ""}
                      </span>
                      <span className="font-semibold text-on-surface">
                        {cutPlan.totals.resultCents === null ? "—" : <Money exact amount={pesos(cutPlan.totals.resultCents)} />}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-soft">
                      Quedan {cutPlan.totals.remainingUnits} piezas en el punto.
                      {cutPlan.totals.writeOffCostCents === null && cutPlan.writeOffAllocations.length > 0
                        ? " La pérdida queda pendiente hasta completar el costo."
                        : ""}
                    </p>
                    {cutPlan.errors.length > 0 ? (
                      <p className="text-xs text-danger">{cutPlan.errors.join(" ")}</p>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  full
                  disabled={
                    busy ||
                    !cutHasInput ||
                    !isRealDate(cutDate) ||
                    !cutPlan ||
                    cutPlan.errors.length > 0
                  }
                  onClick={() => void confirmCut()}
                >
                  Registrar corte
                </Button>
              </div>
            ) : null}

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
                      <span className="text-on-surface-soft">{left} de {entry.quantity} · {formatDate(entry.entryDate)}</span>
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
                    {check.canConvert
                      ? `Listo para surtir · ${formatDate(order.createdAt ?? "")} · ${formatMoneyExact(orderTotals(order).estimatedTotal)}`
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
      <Dialog
        open={!!annulTarget}
        onClose={() => setAnnulling(null)}
        title="Anular corte"
        tone="danger"
        footer={
          annulMonthSealed ? (
            <Button variant="secondary" onClick={() => setAnnulling(null)}>Entendido</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setAnnulling(null)}>Cancelar</Button>
              <Button variant="secondary" disabled={busy || !annulMotive.trim()} onClick={() => void confirmAnnul()}>
                Anular corte
              </Button>
            </>
          )
        }
      >
        {annulTarget ? (
          annulMonthSealed ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-on-surface">El mes de este corte ya tiene un cierre autorizado.</p>
              <p className="text-xs text-on-surface-soft">
                Un periodo autorizado no se reescribe: registra el ajuste en la revisión de ajustes del cierre de ese mes.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-on-surface-soft">
                Corte del {formatDate(annulTarget.effectiveDate ?? "")} · neto{" "}
                <Money exact amount={pesos(annulTarget.totals?.netCents ?? 0)} />. Las piezas vendidas y dadas de baja
                vuelven exactamente como estaban y podrás capturar el corte de nuevo.
              </p>
              <TextField
                label="Motivo"
                placeholder="p. ej. se capturó dos veces"
                value={annulMotive}
                onChange={(e) => setAnnulMotive(e.target.value)}
              />
            </div>
          )
        ) : null}
      </Dialog>

      <Dialog
        open={stocking}
        onClose={() => setStocking(false)}
        title="Surtir del almacén"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStocking(false)}>Cancelar</Button>
            <Button disabled={busy || !Object.values(stockQty).some((value) => Number(value) > 0)} onClick={() => void confirmStock()}>
              Surtir piezas
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Mueve piezas disponibles del almacén a este punto. El precio de etiqueta se propone del nivel del punto; confírmalo o ajústalo por fila.
        </p>
        <TextField
          label="Buscar"
          placeholder="Nombre…"
          value={stockQuery}
          onChange={(e) => setStockQuery(e.target.value)}
        />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {warehouseRows.length === 0 ? (
            <p className="text-sm text-on-surface-soft">No hay piezas disponibles en el almacén.</p>
          ) : (
            warehouseRows.map((row) => (
              <div key={row.key} className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-1 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{row.label}</p>
                  <p className="text-xs text-on-surface-soft">
                    {row.available} en almacén · sugerido <Money amount={row.suggestedPrice} />
                    {row.cost !== undefined ? ` · costo ${formatMoneyExact(row.cost)}` : " · costo pendiente"}
                  </p>
                </div>
                <div className="w-24">
                  <TextField
                    label="Piezas"
                    inputMode="numeric"
                    placeholder="0"
                    value={stockQty[row.key] ?? ""}
                    onChange={(e) => setStockQty((prev) => ({ ...prev, [row.key]: e.target.value }))}
                  />
                </div>
                <div className="w-28">
                  <TextField
                    label="Etiqueta"
                    inputMode="decimal"
                    placeholder={String(row.suggestedPrice)}
                    value={stockPrice[row.key] ?? ""}
                    onChange={(e) => setStockPrice((prev) => ({ ...prev, [row.key]: e.target.value }))}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Dialog>

      <Dialog
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        title="Retirar mercancía"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawing(false)}>Cancelar</Button>
            <Button disabled={busy || !Object.values(withdrawQty).some((value) => Number(value) > 0)} onClick={() => void confirmWithdraw()}>
              Retirar piezas
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Las piezas vuelven al almacén en su variedad exacta y vuelven a estar disponibles para vender.
        </p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {withdrawRows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-1 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-on-surface">{row.label}</p>
                <p className="text-xs text-on-surface-soft">{row.left} en el punto</p>
              </div>
              <div className="w-24">
                <TextField
                  label="Piezas"
                  inputMode="numeric"
                  placeholder="0"
                  value={withdrawQty[row.key] ?? ""}
                  onChange={(e) => setWithdrawQty((prev) => ({ ...prev, [row.key]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={!!payingCorteOp}
        onClose={() => setPayingCorte(null)}
        title="Registrar cobro del corte"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayingCorte(null)}>Cancelar</Button>
            <Button disabled={busy || !isRealDate(payDate)} onClick={() => void confirmPay()}>
              Registrar cobro
            </Button>
          </>
        }
      >
        {payingCorteOp ? (
          <div className="space-y-3">
            <p className="text-sm text-on-surface-soft">
              Importe completo: <span className="font-semibold text-on-surface"><Money exact amount={pesos(payingCorteOp.totals?.netCents ?? 0)} /></span>{" "}
              (corte del {formatDate(payingCorteOp.effectiveDate ?? "")}).
            </p>
            <TextField
              label="Fecha real del cobro"
              inputMode="numeric"
              placeholder="AAAA-MM-DD"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
            <SelectField
              label="Medio"
              value={payMethod}
              onChange={(value) => setPayMethod(value as "cash" | "transfer")}
              options={[
                { value: "cash", label: "Efectivo" },
                { value: "transfer", label: "Transferencia" },
              ]}
            />
            <p className="text-xs text-on-surface-soft">
              La fecha decide en qué mes entra el dinero, aunque la venta quedó en el mes del corte.
            </p>
          </div>
        ) : null}
      </Dialog>
    </Screen>
  );
}
