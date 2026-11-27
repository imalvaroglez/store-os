// #524 — Ventas → Puntos de venta (first verifiable UI cut): list the
// store's points with their live pieces/valuation, create a point, and give
// an EMPTY ficha its first surtido via «Usar como surtido inicial» — the
// preview shows destination, physical date, pieces/variants and marked
// prices (from the order, exact cents), and the TRUSTED callable does the
// whole movement in one transaction. Cortes/cobros/anulación and manual
// Surtir/Retirar arrive in later cuts.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { StockPointDialog } from "./StockPointDialog";
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
  TabList,
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

/** One sellable row per product + color + marked price with pieces left —
 * the shared aggregation of the corte capture and the #583 correction. */
type SellableRow = { key: string; entry: PointEntry; label: string; left: number };
function sellableRows(entries: PointEntry[]): SellableRow[] {
  const byKey = new Map<string, SellableRow>();
  for (const entry of entries) {
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
}

/** #583: operator-facing status of a corte registro. */
const CORTE_STATUS_LABEL: Record<string, string> = {
  pendiente_de_cobro: "por cobrar",
  sin_cobro: "sin cobro",
  cobrado: "cobrado",
  anulado: "anulado",
};
function corteStatusLabel(corte: PointOperation): string {
  if (corte.status === "anulado" && corte.replacedByCorteId) return "corregido";
  return CORTE_STATUS_LABEL[corte.status ?? ""] ?? "";
}

/** Cents → pesos for the Money component (whole-peso rounding, exact cents kept). */
const pesos = (cents: number): number => Math.round(cents) / 100;
import { uid } from "../../lib/ids";
import { orderReference } from "../../lib/orders";
import {
  buildFirstSurtidoFromOrder,
  corteUndoImpediments,
  orderConversionImpediments,
  planCorte,
  pointSummaries,
} from "../../lib/pointOfSale";
import {
  exhibitorDeliveryImpediments,
  exhibitorSummary,
  groupExhibitorsByLine,
} from "../../lib/pointExhibitors";
import type { Order, PointEntry, PointOfSale, PointOperation } from "../../types";

/** A real calendar date (YYYY-MM-DD), semantics checked before confirming. */
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(text: string): boolean {
  if (!VALID_DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function PointsOfSaleScreen() {
  const {
    state,
    activeStore,
    savePoint,
    convertOrderToFirstSurtido,
    registerPointCut,
    registerPointCutPayment,
    withdrawFromPoint,
    annulPointCut,
    correctPointCut,
    deliverPointExhibitors,
    confirmExhibitorCost: confirmExhibitorCostCall,
    withdrawPointExhibitors,
  } = useStore();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [openPointId, setOpenPointId] = useState<string | null>(null);
  // #574: the ficha is its own view — remember where the list was so
  // «Volver a puntos» lands the operator back in the same position.
  const [listScrollY, setListScrollY] = useState(0);
  // #574: search the open ficha's entries by product or variant.
  const [fichaQuery, setFichaQuery] = useState("");
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
  // #524/#569 manual movements: warehouse → point (stocking) lives in
  // StockPointDialog; point → warehouse (retreat) stays here.
  const [stocking, setStocking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawQty, setWithdrawQty] = useState<Record<string, string>>({});
  // #524 annulment: the latest unpaid corte, with the open-month check.
  const [annulling, setAnnulling] = useState<string | null>(null);
  const [annulMotive, setAnnulMotive] = useState("");
  const [sealedPeriods, setSealedPeriods] = useState<Set<string>>(new Set());
  // #583 correction: the dialog recovers the corte's own capture (per-row
  // sold quantities + bajas), shows the effect before confirming and keeps
  // everything if the replacement fails.
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctQtyByRow, setCorrectQtyByRow] = useState<Record<string, string>>({});
  const [correctBajas, setCorrectBajas] = useState<Array<{ rowKey: string; qty: string; reason: string }>>([]);
  const [correctQuery, setCorrectQuery] = useState("");
  const [correctMotive, setCorrectMotive] = useState("");
  const [correctIntentId, setCorrectIntentId] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const [payMethod, setPayMethod] = useState<"cash" | "transfer">("cash");
  // #524 Exhibidores: the ficha's tab + delivery/cost/withdrawal capture.
  const [pointTab, setPointTab] = useState<"mercancia" | "exhibidores">("mercancia");
  const [delivering, setDelivering] = useState(false);
  const [exhibDate, setExhibDate] = useState(todayIso());
  const [exhibOpening, setExhibOpening] = useState(false);
  const [exhibLines, setExhibLines] = useState<Array<{ key: string; name: string; qty: string; cost: string }>>([
    { key: uid("exl"), name: "", qty: "", cost: "" },
  ]);
  const [deliverIntentId, setDeliverIntentId] = useState("");
  const [confirmingCostKey, setConfirmingCostKey] = useState<string | null>(null);
  const [confirmCostValue, setConfirmCostValue] = useState("");
  const [withdrawingExhibitors, setWithdrawingExhibitors] = useState(false);
  const [exhibWithdrawDate, setExhibWithdrawDate] = useState(todayIso());
  const [exhibWithdrawQty, setExhibWithdrawQty] = useState<Record<string, string>>({});
  const [exhibWithdrawIntentId, setExhibWithdrawIntentId] = useState("");

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
  const openSummary = openPoint ? summaries.get(openPoint.id) ?? null : null;
  const pointEntries = useMemo(
    () =>
      openPoint
        ? state.pointEntries
            .filter((e) => e.pointId === openPoint.id)
            .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt))
        : [],
    [state.pointEntries, openPoint]
  );

  // #574: the ficha's visible entries — the search narrows what the operator
  // SEES, never the underlying historial (clearing the box brings it back).
  const visibleEntries = useMemo(() => {
    const needle = fichaQuery.trim().toLowerCase();
    if (!needle) return pointEntries;
    return pointEntries.filter(
      (entry) =>
        entry.productName.toLowerCase().includes(needle) ||
        (entry.variantColor ?? "").toLowerCase().includes(needle)
    );
  }, [pointEntries, fichaQuery]);

  // #524 corte capture rows: one sellable row per product + color + marked
  // price with pieces remaining (coexisting prices stay separate rows so the
  // operator sells at the price she actually charged).
  const cutRows = useMemo(() => sellableRows(pointEntries), [pointEntries]);

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

  // The point's price level drives every suggested label price (#569: the
  // stocking dialog resolves each variant's own/shared price with it).
  const tierId = openPoint?.priceTierId ?? activeStore?.defaultTierId ?? "t_retail";

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

  // #524 Exhibidores: this point's fixture registry — summaries, row groups
  // and the withdrawal history all derive from the piece docs.
  const pointExhibitorPieces = useMemo(
    () => (openPoint ? state.pointExhibitors.filter((piece) => piece.pointId === openPoint.id) : []),
    [state.pointExhibitors, openPoint]
  );
  const exhibitorTotals = useMemo(() => exhibitorSummary(pointExhibitorPieces), [pointExhibitorPieces]);
  const exhibitorGroups = useMemo(() => groupExhibitorsByLine(pointExhibitorPieces), [pointExhibitorPieces]);
  const assignedExhibitorGroups = useMemo(
    () => exhibitorGroups.filter((group) => group.pieces.some((piece) => piece.withdrawnAt === undefined)),
    [exhibitorGroups]
  );
  const assignedExhibitorCount = useMemo(
    () => pointExhibitorPieces.filter((piece) => piece.withdrawnAt === undefined).length,
    [pointExhibitorPieces]
  );
  const withdrawnExhibitorPieces = useMemo(
    () =>
      pointExhibitorPieces
        .filter((piece) => piece.withdrawnAt !== undefined)
        .sort((a, b) => (b.withdrawnAt ?? "").localeCompare(a.withdrawnAt ?? "") || a.id.localeCompare(b.id)),
    [pointExhibitorPieces]
  );

  // Delivery dialog plan: filled rows only; the lib rules out bad input and
  // the button waits for a clean verdict (dates included).
  const exhibitorPlan = useMemo(() => {
    if (!delivering) return null;
    const filled = exhibLines
      .filter((line) => line.name.trim() !== "" || line.qty.trim() !== "" || line.cost.trim() !== "")
      .map((line) => {
        const costText = line.cost.trim();
        const cost = costText === "" ? undefined : parseAmount(costText);
        return {
          name: line.name,
          quantity: Number(line.qty),
          ...(cost !== undefined ? { unitCostCents: orderAmountCents(cost, 1) } : {}),
        };
      });
    return { filled, check: exhibitorDeliveryImpediments(filled, exhibDate) };
  }, [delivering, exhibLines, exhibDate]);
  const exhibitorDialogTotal = useMemo(() => {
    if (!exhibitorPlan) return null;
    let cents = 0;
    let pending = 0;
    for (let index = 0; index < exhibitorPlan.filled.length; index += 1) {
      const line = exhibitorPlan.filled[index];
      const qty = Math.max(0, Math.floor(line.quantity));
      if (line.unitCostCents !== undefined) cents += qty * line.unitCostCents;
      else pending += qty;
    }
    return { cents, pending };
  }, [exhibitorPlan]);
  // #583: the ficha's corte registros — every corte of the point, newest
  // first, each identified by date, status and net. Undo actions (corregir /
  // anular) live ON the registro, offered only when the shared eligibility
  // (mirror of the server guard) says the transaction will accept it.
  const pointCortes = useMemo(() => pointOperations.filter((op) => op.kind === "corte"), [pointOperations]);
  // #583: the undo motive (anulación o corrección) rides on the evidence op —
  // the registro keeps it consultable next to the corte it rewrote.
  const undoMotiveByCorte = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of pointOperations) {
      if ((op.kind === "anulacion" || op.kind === "correccion") && op.corteId && op.motive) {
        map.set(op.corteId, op.motive);
      }
    }
    return map;
  }, [pointOperations]);
  const correctTarget = pointOperations.find((op) => op.id === correcting) ?? null;
  // The correction re-captures over the RESTORED availability: what the
  // original corte consumed comes back for its replacement.
  const correctedEntries = useMemo(() => {
    if (!correctTarget) return [];
    const restored = new Map<string, number>();
    for (const group of [...(correctTarget.saleAllocations ?? []), ...(correctTarget.writeOffAllocations ?? [])]) {
      for (const allocation of group.allocations ?? []) {
        restored.set(allocation.entryId, (restored.get(allocation.entryId) ?? 0) + allocation.quantity);
      }
    }
    return pointEntries.map((entry) => ({
      ...entry,
      consumedQty: Math.max(0, entry.consumedQty - (restored.get(entry.id) ?? 0)),
    }));
  }, [correctTarget, pointEntries]);
  const correctRows = useMemo(
    () => (correctTarget ? sellableRows(correctedEntries) : []),
    [correctTarget, correctedEntries]
  );
  const correctCommission = correctTarget?.commissionRate ?? openPoint?.commissionRate ?? 0.2;
  const correctPlan = useMemo(() => {
    if (!correctTarget) return null;
    const lines = correctRows
      .map((row) => ({ row, sold: Number(correctQtyByRow[row.key] ?? "") }))
      .filter((item) => Number.isFinite(item.sold) && item.sold > 0)
      .map((item) => ({
        productId: item.row.entry.productId,
        ...(item.row.entry.variantId ? { variantId: item.row.entry.variantId } : {}),
        markedPriceCents: item.row.entry.markedPriceCents,
        soldQty: Math.floor(item.sold),
      }));
    const writeOffs = correctBajas
      .map((baja) => {
        const row = correctRows.find((candidate) => candidate.key === baja.rowKey);
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
    return planCorte(correctedEntries, lines, writeOffs, correctCommission);
  }, [correctTarget, correctRows, correctQtyByRow, correctBajas, correctedEntries, correctCommission]);
  const correctHasInput = useMemo(
    () => Object.values(correctQtyByRow).some((value) => Number(value) > 0) || correctBajas.some((baja) => Number(baja.qty) > 0),
    [correctQtyByRow, correctBajas]
  );
  const originalPieces = (correctTarget?.lines ?? []).reduce((sum, line) => sum + (line.soldQty ?? 0), 0);
  const originalBajas = (correctTarget?.writeOffs ?? []).reduce((sum, writeOff) => sum + (writeOff.qty ?? 0), 0);
  const correctedPieces = correctPlan
    ? correctPlan.saleAllocations.reduce((sum, group) => sum + group.allocations.reduce((inner, allocation) => inner + allocation.quantity, 0), 0)
    : 0;
  const correctedBajas = correctPlan
    ? correctPlan.writeOffAllocations.reduce((sum, group) => sum + group.allocations.reduce((inner, allocation) => inner + allocation.quantity, 0), 0)
    : 0;
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

  // #574: opening a point swaps the list for its ficha and remembers the
  // scroll position; «Volver a puntos» restores it and clears the search.
  function openPointById(id: string) {
    setListScrollY(window.scrollY);
    setFichaQuery("");
    setOpenPointId(id);
  }

  function backToPoints() {
    setOpenPointId(null);
    setFichaQuery("");
    window.scrollTo(0, listScrollY);
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
      openPointById(point.id);
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
  // #524 M1 (QA 25-nov): the SAME discipline for every money/stock operation.
  // The intent is minted when the dialog OPENS and survives failed attempts;
  // a retry reuses it, so a commit whose response was lost answers
  // already-applied instead of applying the cut/charge twice. Only a
  // CONFIRMED outcome (applied or already-applied) retires it — the next
  // session mints a fresh one. Editing rows between attempts keeps the
  // intent: if the lost attempt committed, the retry refuses (never
  // double-applies).
  const [cutIntentId, setCutIntentId] = useState("");
  const [payIntentId, setPayIntentId] = useState("");
  const [annulIntentId, setAnnulIntentId] = useState("");
  const [withdrawIntentId, setWithdrawIntentId] = useState("");
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
        intentId: cutIntentId,
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
      setCutIntentId("");
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
        intentId: payIntentId,
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
      setPayIntentId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar el cobro.");
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
      const result = await withdrawFromPoint({ storeId, pointId: openPoint.id, intentId: withdrawIntentId, lines });
      toast.success(
        result.withdrawn
          ? `Retiro: ${result.units} piezas de vuelta al almacén.`
          : "Este retiro ya estaba aplicado; no se hizo ningún cambio."
      );
      setWithdrawing(false);
      setWithdrawQty({});
      setWithdrawIntentId("");
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
        intentId: annulIntentId,
        motive: annulMotive.trim(),
      });
      toast.success(result.registered ? "Corte anulado: las piezas vuelven al punto." : "Este corte ya estaba anulado.");
      setAnnulling(null);
      setAnnulMotive("");
      setAnnulIntentId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo anular el corte.");
    } finally {
      setBusy(false);
    }
  }

  /** #583: open the correction ON the corte's registro — the capture comes
   * back exactly as it was confirmed (quantities per row, bajas with their
   * motives) over the restored availability, and the intent is minted here
   * so a retry after a lost response reuses it. */
  function openCorrection(corte: PointOperation) {
    const keyOf = (productId: string, variantId: string | undefined, price: number) =>
      `${productId}|${variantId ?? ""}|${price}`;
    const qty: Record<string, string> = {};
    for (const line of corte.lines ?? []) {
      qty[keyOf(line.productId, line.variantId, line.markedPriceCents)] = String(line.soldQty);
    }
    setCorrectQtyByRow(qty);
    setCorrectBajas(
      (corte.writeOffs ?? []).map((writeOff) => ({
        rowKey: keyOf(writeOff.productId, writeOff.variantId, writeOff.markedPriceCents),
        qty: String(writeOff.qty),
        reason: writeOff.reason,
      }))
    );
    setCorrectQuery("");
    setCorrectMotive("");
    setCorrectIntentId(uid());
    setCorrecting(corte.id);
  }

  async function confirmCorrectCut() {
    if (!openPoint || !correctTarget || !correctPlan || correctPlan.errors.length > 0 || !correctMotive.trim()) return;
    setBusy(true);
    try {
      const lines = correctRows
        .map((row) => ({ row, sold: Number(correctQtyByRow[row.key] ?? "") }))
        .filter((item) => Number.isFinite(item.sold) && item.sold > 0)
        .map((item) => ({
          productId: item.row.entry.productId,
          ...(item.row.entry.variantId ? { variantId: item.row.entry.variantId } : {}),
          markedPriceCents: item.row.entry.markedPriceCents,
          soldQty: Math.floor(item.sold),
        }));
      const writeOffs = correctBajas
        .map((baja) => {
          const row = correctRows.find((candidate) => candidate.key === baja.rowKey);
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
      const result = await correctPointCut({
        storeId,
        pointId: openPoint.id,
        corteId: correctTarget.id,
        intentId: correctIntentId,
        motive: correctMotive.trim(),
        lines,
        writeOffs,
      });
      const net = result.totals?.netCents;
      toast.success(
        result.corrected
          ? typeof net === "number" && net > 0
            ? `Corte corregido. Neto por cobrar: ${formatMoneyExact(pesos(net))}.`
            : "Corte corregido sin cobro pendiente."
          : "Esta corrección ya estaba aplicada; no se hizo ningún cambio."
      );
      setCorrecting(null);
      setCorrectQtyByRow({});
      setCorrectBajas([]);
      setCorrectMotive("");
      setCorrectQuery("");
      setCorrectIntentId("");
    } catch (error) {
      // The callable re-validates authoritatively; its Spanish message names
      // the real impediment — the capture stays for a retry, never lost.
      toast.error(error instanceof Error ? error.message : "No se pudo corregir el corte.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExhibitorDelivery() {
    if (!openPoint || !exhibitorPlan || !exhibitorPlan.check.canDeliver || exhibitorPlan.filled.length === 0) return;
    setBusy(true);
    try {
      const result = await deliverPointExhibitors({
        storeId,
        pointId: openPoint.id,
        intentId: deliverIntentId,
        physicalDate: exhibDate,
        opening: exhibOpening,
        lines: exhibitorPlan.filled,
      });
      toast.success(
        result.delivered
          ? `Entrega registrada: ${result.pieces} ${result.pieces === 1 ? "exhibidor" : "exhibidores"}${exhibOpening ? " de apertura" : ""}.`
          : "Esta entrega ya estaba registrada; no se hizo ningún cambio."
      );
      setDelivering(false);
      setExhibLines([{ key: uid("exl"), name: "", qty: "", cost: "" }]);
      setExhibOpening(false);
      setExhibDate(todayIso());
      setDeliverIntentId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo registrar la entrega.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExhibitorCost() {
    if (!openPoint || confirmingCostKey === null) return;
    const group = exhibitorGroups.find((candidate) => candidate.key === confirmingCostKey) ?? null;
    const cost = parseAmount(confirmCostValue.trim());
    if (!group || cost === undefined) return;
    // The row's still-assigned pieces without a confirmed cost.
    const pending = group.pieces.filter((piece) => piece.withdrawnAt === undefined && piece.unitCostCents === undefined);
    if (pending.length === 0) return;
    setBusy(true);
    try {
      const result = await confirmExhibitorCostCall({
        storeId,
        pointId: openPoint.id,
        items: pending.map((piece) => ({ exhibitorId: piece.id, unitCostCents: orderAmountCents(cost, 1) })),
      });
      const applied = result.confirmed ?? 0;
      toast.success(
        applied > 0
          ? `Costo confirmado: ${formatMoneyExact(cost)} por pieza (${applied} ${applied === 1 ? "pieza" : "piezas"}).`
          : "Esas piezas ya tenían el costo confirmado; no se hizo ningún cambio."
      );
      setConfirmingCostKey(null);
      setConfirmCostValue("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo confirmar el costo.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExhibitorWithdrawal() {
    if (!openPoint) return;
    const lines = assignedExhibitorGroups
      .map((group) => ({
        group,
        qty: Number(exhibWithdrawQty[group.key] ?? ""),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.qty) &&
          item.qty > 0 &&
          item.qty <= item.group.pieces.filter((piece) => piece.withdrawnAt === undefined).length
      )
      .map((item) => ({ deliveryId: item.group.deliveryId, lineIndex: item.group.lineIndex, quantity: Math.floor(item.qty) }));
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const result = await withdrawPointExhibitors({
        storeId,
        pointId: openPoint.id,
        intentId: exhibWithdrawIntentId,
        physicalDate: exhibWithdrawDate,
        lines,
      });
      toast.success(
        result.withdrawn
          ? `Retiro registrado: ${result.pieces} ${result.pieces === 1 ? "exhibidor" : "exhibidores"} de vuelta contigo.`
          : "Este retiro ya estaba aplicado; no se hizo ningún cambio."
      );
      setWithdrawingExhibitors(false);
      setExhibWithdrawQty({});
      setExhibWithdrawDate(todayIso());
      setExhibWithdrawIntentId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo retirar el exhibidor.");
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
        {!openPoint && points.length === 0 ? (
          <EmptyState
            title="Aún no tienes puntos de venta"
            subtitle="Un punto de venta es un mostrador o vitrina donde dejas mercancía. Crea el primero y dale su surtido inicial."
            action={<Button onClick={() => setCreating(true)}>Crear el primer punto</Button>}
          />
        ) : null}
        {!openPoint
          ? points.map((point) => {
            const summary = summaries.get(point.id);
            return (
              <Card key={point.id} className="space-y-2">
                <Button
                  variant="ghost"
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                  onClick={() => openPointById(point.id)}
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
          : null}

        {openPoint ? (
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={backToPoints}>
                Volver a puntos
              </Button>
              <Badge>{(() => { const oldest = summaries.get(openPoint.id)?.oldestEntryDate; return oldest ? `Pieza más antigua desde el ${formatDate(oldest)}` : "Ficha"; })()}</Badge>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-ink">{openPoint.name}</h3>
              <span className="text-sm text-on-surface-soft">
                {openSummary ? `${openSummary.units} piezas` : "Sin mercancía"}
              </span>
            </div>
            {openSummary ? (
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <p className="text-on-surface-soft">
                  Valor al precio marcado: <span className="font-semibold text-on-surface"><Money exact amount={pesos(openSummary.markedValueCents)} /></span>
                </p>
                <p className="text-on-surface-soft">
                  Valor al costo: <span className="font-semibold text-on-surface"><Money exact amount={pesos(openSummary.costValueCents)} /></span>
                  {openSummary.pendingCostUnits > 0 ? ` (${openSummary.pendingCostUnits} con costo pendiente)` : ""}
                </p>
              </div>
            ) : null}
            <TabList
              id={`${openPoint.id}-ficha`}
              label="Secciones del punto"
              value={pointTab}
              items={[
                { value: "mercancia", label: "Mercancía" },
                { value: "exhibidores", label: "Exhibidores" },
              ]}
              onChange={(value) => setPointTab(value === "exhibidores" ? "exhibidores" : "mercancia")}
            />
            <section id={`${openPoint.id}-ficha-panel`} role="tabpanel" aria-labelledby={`${openPoint.id}-ficha-tab-${pointTab}`} className="space-y-3">
            {pointTab === "mercancia" ? (
              <>
            {openPoint ? (
              <div className="flex flex-wrap gap-2">
                {pointEntries.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => setStocking(true)}>
                    Surtir del almacén
                  </Button>
                ) : null}
                {summaryHasStock(cutRows) ? (
                  <Button variant="ghost" size="sm" onClick={() => { setWithdrawing(true); setWithdrawIntentId(uid()); }}>
                    Retirar
                  </Button>
                ) : null}
              </div>
            ) : null}

            {pointEntries.length > 0 && summaryHasStock(cutRows) ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (!cutOpen) setCutIntentId(uid());
                  setCutOpen(!cutOpen);
                  setCutDate(todayIso());
                }}
              >
                {cutOpen ? "Cerrar captura" : "Registrar corte"}
              </Button>
            ) : null}

            {pointCortes.length > 0 ? (
              <div className="space-y-2 rounded-xl bg-surface p-3 ring-1 ring-edge">
                <p className="text-sm font-semibold text-on-surface">Cortes del punto</p>
                {pointCortes.map((corte) => {
                  // #583: eligibility mirrors the server's transactional
                  // guard — the ficha never offers what it would reject.
                  // Cobro is SEPARATE: every pendiente_de_cobro corte keeps
                  // its payment path (the server only needs the payment's
                  // own month open — later movements never block charging).
                  const undo = corteUndoImpediments(corte, pointOperations, sealedPeriods);
                  return (
                    <div key={corte.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="text-on-surface-soft">
                        {formatDate(corte.effectiveDate ?? "")} · {corteStatusLabel(corte)} · neto{" "}
                        <span className="font-semibold text-on-surface"><Money exact amount={pesos(corte.totals?.netCents ?? 0)} /></span>
                      </span>
                      {corte.status === "pendiente_de_cobro" ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setPayingCorte(corte.id);
                            setPayIntentId(uid());
                            setPayDate(todayIso());
                          }}
                        >
                          Registrar cobro
                        </Button>
                      ) : null}
                      {undo.canUndo ? (
                        <span className="flex flex-wrap gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openCorrection(corte)}>
                            Corregir corte
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setAnnulling(corte.id); setAnnulMotive(""); setAnnulIntentId(uid()); }}>
                            Anular corte
                          </Button>
                        </span>
                      ) : (
                        <span className="text-xs text-on-surface-soft">
                          {undo.reasons[0]}
                          {corte.status === "anulado" && undoMotiveByCorte.get(corte.id)
                            ? ` Motivo: ${undoMotiveByCorte.get(corte.id)}`
                            : ""}
                        </span>
                      )}
                    </div>
                  );
                })}
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
                subtitle="Súrtelo directamente del almacén eligiendo piezas y variantes, o convierte un pedido confirmado: las piezas reservadas pasan al punto con su precio y su costo."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => setStocking(true)}>Surtir del almacén</Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSurtidoOrder(null);
                        setPhysicalDate(todayIso());
                        setPickingOrder(true);
                      }}
                    >
                      Usar como surtido inicial
                    </Button>
                  </div>
                }
              />
            ) : (
              <div className="space-y-3">
                <TextField
                  label="Buscar"
                  placeholder="Producto o variante…"
                  value={fichaQuery}
                  onChange={(e) => setFichaQuery(e.target.value)}
                />
                {visibleEntries.length === 0 ? (
                  <p className="text-sm text-on-surface-soft">Sin resultados para esta búsqueda.</p>
                ) : (
                  <>
                    {/* Escritorio: columnas con encabezados estables y cifras a la derecha. */}
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-rule text-left text-xs text-on-surface-soft">
                            <th scope="col" className="py-2 pr-3 font-medium">Producto y variante</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">Disponibles</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">Precio marcado</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">Costo unitario</th>
                            <th scope="col" className="py-2 pl-2 text-right font-medium">Fecha de entrada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleEntries.map((entry) => {
                            const left = Math.max(0, entry.quantity - entry.consumedQty);
                            return (
                              <tr key={entry.id} className="border-b border-rule last:border-0">
                                <td className="py-2 pr-3">
                                  <p className="font-medium text-on-surface">{entry.productName}</p>
                                  {entry.variantColor ? (
                                    <p className="text-xs text-on-surface-soft">{entry.variantColor}</p>
                                  ) : null}
                                </td>
                                <td className="px-2 py-2 text-right text-on-surface">
                                  {left}
                                  {entry.consumedQty > 0 ? ` de ${entry.quantity}` : ""}
                                </td>
                                <td className="px-2 py-2 text-right font-semibold text-on-surface">
                                  <Money exact amount={pesos(entry.markedPriceCents)} />
                                </td>
                                <td className="px-2 py-2 text-right text-on-surface-soft">
                                  {entry.unitCostCents !== undefined ? formatMoneyExact(pesos(entry.unitCostCents)) : "costo pendiente"}
                                </td>
                                <td className="py-2 pl-2 text-right text-on-surface-soft">{formatDate(entry.entryDate)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Móvil: renglones compactos, etiquetas claras y variantes completas. */}
                    <div className="space-y-2 md:hidden">
                      {visibleEntries.map((entry) => {
                        const left = Math.max(0, entry.quantity - entry.consumedQty);
                        return (
                          <div key={entry.id} className="border-b border-rule pb-2 last:border-0">
                            <p className="text-sm font-medium text-on-surface">{entry.productName}</p>
                            {entry.variantColor ? (
                              <p className="text-xs text-on-surface-soft">{entry.variantColor}</p>
                            ) : null}
                            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                              <p className="text-on-surface-soft">Disponibles</p>
                              <p className="text-right font-semibold text-on-surface">
                                {left}
                                {entry.consumedQty > 0 ? ` de ${entry.quantity}` : ""}
                              </p>
                              <p className="text-on-surface-soft">Precio marcado</p>
                              <p className="text-right font-semibold text-on-surface"><Money exact amount={pesos(entry.markedPriceCents)} /></p>
                              <p className="text-on-surface-soft">Costo unitario</p>
                              <p className="text-right font-semibold text-on-surface">
                                {entry.unitCostCents !== undefined ? formatMoneyExact(pesos(entry.unitCostCents)) : "costo pendiente"}
                              </p>
                              <p className="text-on-surface-soft">Fecha de entrada</p>
                              <p className="text-right text-on-surface-soft">{formatDate(entry.entryDate)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
              </>
            ) : (
              <div className="space-y-3">
                {pointExhibitorPieces.length === 0 ? (
                  <EmptyState
                    title="Este punto todavía no tiene exhibidores"
                    subtitle="Registra los exhibidores que le entregas a este punto: tablas, vitrinas, barrales. Su costo se lleva aparte de la mercancía."
                    action={
                      <Button onClick={() => { setDelivering(true); setDeliverIntentId(uid("pex")); }}>
                        Registrar entrega
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <p className="text-on-surface-soft">
                        Costo de apertura:{" "}
                        <span className="font-semibold text-on-surface"><Money exact amount={pesos(exhibitorTotals.openingCostCents)} /></span>
                        {exhibitorTotals.openingPendingUnits > 0 ? ` (${exhibitorTotals.openingPendingUnits} sin valorar)` : ""}
                      </p>
                      <p className="text-on-surface-soft">
                        Costo de exhibidores asignados:{" "}
                        <span className="font-semibold text-on-surface"><Money exact amount={pesos(exhibitorTotals.assignedCostCents)} /></span>
                        {exhibitorTotals.assignedPendingUnits > 0 ? ` (${exhibitorTotals.assignedPendingUnits} sin valorar)` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => { setDelivering(true); setDeliverIntentId(uid("pex")); }}
                      >
                        Registrar entrega
                      </Button>
                      {assignedExhibitorCount > 0 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setWithdrawingExhibitors(true);
                            setExhibWithdrawDate(todayIso());
                            setExhibWithdrawIntentId(uid("pexw"));
                          }}
                        >
                          Retirar exhibidores
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      {assignedExhibitorGroups.map((group) => {
                        const assigned = group.pieces.filter((piece) => piece.withdrawnAt === undefined);
                        const pending = assigned.filter((piece) => piece.unitCostCents === undefined);
                        const knownCost = assigned.find((piece) => piece.unitCostCents !== undefined)?.unitCostCents;
                        return (
                          <div key={group.key} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-1 text-sm last:border-0">
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-medium text-on-surface">{assigned.length} × {group.name}</span>
                              {group.opening ? <Badge>Apertura</Badge> : ""}
                            </span>
                            <span className="text-on-surface-soft">{formatDate(group.deliveredAt)}</span>
                            {pending.length === 0 && knownCost !== undefined ? (
                              <span className="text-on-surface-soft">costo {formatMoneyExact(pesos(knownCost))} c/u</span>
                            ) : (
                              <>
                                <Badge tone="warning">{pending.length} con costo pendiente</Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setConfirmingCostKey(group.key); setConfirmCostValue(""); }}
                                >
                                  Confirmar costo
                                </Button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {withdrawnExhibitorPieces.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-on-surface">Retirados</p>
                        {withdrawnExhibitorPieces.map((piece) => (
                          <div key={piece.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-1 text-sm last:border-0">
                            <span className="min-w-0 flex-1 truncate text-on-surface-soft">
                              {piece.name}
                              {piece.opening ? " (apertura)" : ""}
                            </span>
                            <span className="text-on-surface-soft">
                              entregado {formatDate(piece.deliveredAt)} · retirado {formatDate(piece.withdrawnAt ?? "")}
                            </span>
                            <span className="text-on-surface-soft">
                              {piece.unitCostCents !== undefined ? `costo ${formatMoneyExact(pesos(piece.unitCostCents))}` : "sin costo"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
            </section>
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
        open={!!correctTarget}
        onClose={() => setCorrecting(null)}
        title="Corregir corte"
        tone="danger"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrecting(null)}>Cancelar</Button>
            <Button
              variant="secondary"
              disabled={busy || !correctHasInput || !correctMotive.trim() || !correctPlan || correctPlan.errors.length > 0}
              onClick={() => void confirmCorrectCut()}
            >
              Corregir corte
            </Button>
          </>
        }
      >
        {correctTarget ? (
          <div className="space-y-3">
            <p className="text-sm text-on-surface-soft">
              Corte del {formatDate(correctTarget.effectiveDate ?? "")} · original {originalPieces}{" "}
              {originalPieces === 1 ? "pieza" : "piezas"}
              {originalBajas > 0 ? ` + ${originalBajas} de baja` : ""} · neto{" "}
              <Money exact amount={pesos(correctTarget.totals?.netCents ?? 0)} />. La corrección reemplaza la captura
              en un solo paso: la fecha efectiva y la comisión se conservan, el original queda anulado y vinculado.
            </p>
            <TextField
              label="Buscar"
              placeholder="Nombre o clave…"
              value={correctQuery}
              onChange={(e) => setCorrectQuery(e.target.value)}
            />
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {correctRows
                .filter((row) => {
                  const needle = correctQuery.trim().toLowerCase();
                  if (!needle) return true;
                  return row.label.toLowerCase().includes(needle) || row.entry.productName.toLowerCase().includes(needle);
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
                        value={correctQtyByRow[row.key] ?? ""}
                        onChange={(e) => setCorrectQtyByRow((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      />
                    </div>
                  </div>
                ))}
              <div className="space-y-2 pt-2">
                <p className="text-sm font-semibold text-on-surface">Bajas (daño o pérdida)</p>
                {correctBajas.map((baja, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_1fr_auto] sm:items-end">
                    <SelectField
                      label="Pieza"
                      value={baja.rowKey}
                      onChange={(value) =>
                        setCorrectBajas((prev) => prev.map((item, i) => (i === index ? { ...item, rowKey: value } : item)))
                      }
                      options={correctRows.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
                    />
                    <TextField
                      label="Cantidad"
                      inputMode="numeric"
                      placeholder="0"
                      value={baja.qty}
                      onChange={(e) => setCorrectBajas((prev) => prev.map((item, i) => (i === index ? { ...item, qty: e.target.value } : item)))}
                    />
                    <TextField
                      label="Motivo"
                      placeholder="p. ej. dañada en mostrador"
                      value={baja.reason}
                      onChange={(e) => setCorrectBajas((prev) => prev.map((item, i) => (i === index ? { ...item, reason: e.target.value } : item)))}
                    />
                    <Button variant="ghost" onClick={() => setCorrectBajas((prev) => prev.filter((_, i) => i !== index))}>
                      Quitar
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setCorrectBajas((prev) => [...prev, { rowKey: correctRows[0]?.key ?? "", qty: "", reason: "" }])}>
                  + Agregar baja
                </Button>
              </div>
            </div>
            {correctPlan ? (
              <div className="space-y-1 rounded-xl bg-paper p-3 ring-1 ring-edge text-sm">
                <p className="text-on-surface-soft">
                  Original: {originalPieces} {originalPieces === 1 ? "pieza" : "piezas"}
                  {originalBajas > 0 ? ` + ${originalBajas} de baja` : ""} · neto {formatMoneyExact(pesos(correctTarget.totals?.netCents ?? 0))}
                </p>
                <p className="font-semibold text-on-surface">
                  Corregido: {correctedPieces} {correctedPieces === 1 ? "pieza" : "piezas"}
                  {correctedBajas > 0 ? ` + ${correctedBajas} de baja` : ""} · neto {formatMoneyExact(pesos(correctPlan.totals.netCents))}
                </p>
                <p className="text-xs text-on-surface-soft">
                  Quedan {correctPlan.totals.remainingUnits} piezas en el punto.
                </p>
                {correctPlan.errors.length > 0 ? (
                  <p className="text-xs text-danger">{correctPlan.errors.join(" ")}</p>
                ) : null}
              </div>
            ) : null}
            <TextField
              label="Motivo de la corrección"
              placeholder="p. ej. eran 2 piezas, no 3"
              value={correctMotive}
              onChange={(e) => setCorrectMotive(e.target.value)}
            />
          </div>
        ) : null}
      </Dialog>

      <StockPointDialog
        open={stocking}
        point={openPoint}
        products={state.products.filter((p) => p.storeId === storeId)}
        tierId={tierId}
        onClose={() => setStocking(false)}
      />

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

      <Dialog
        open={delivering}
        onClose={() => setDelivering(false)}
        title="Registrar entrega de exhibidores"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelivering(false)}>Cancelar</Button>
            <Button
              disabled={busy || !exhibitorPlan || exhibitorPlan.filled.length === 0 || !exhibitorPlan.check.canDeliver}
              onClick={() => void confirmExhibitorDelivery()}
            >
              Entregar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <TextField
            label="Fecha de entrega"
            inputMode="numeric"
            placeholder="AAAA-MM-DD"
            value={exhibDate}
            onChange={(e) => setExhibDate(e.target.value)}
          />
          <CheckboxField
            label="Entrega de apertura"
            caption="Identifica los exhibidores con los que abrió este punto; su costo se conserva como apertura aunque después se retiren."
            checked={exhibOpening}
            onChange={(checked) => setExhibOpening(checked)}
          />
          <div className="space-y-2">
            {exhibLines.map((line, index) => (
              <div key={line.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_7rem_auto] sm:items-end">
                <TextField
                  label="Exhibidor"
                  placeholder="p. ej. Tabla plegable"
                  value={line.name}
                  onChange={(e) => setExhibLines((prev) => prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))}
                />
                <TextField
                  label="Piezas"
                  inputMode="numeric"
                  placeholder="0"
                  value={line.qty}
                  onChange={(e) => setExhibLines((prev) => prev.map((item, i) => (i === index ? { ...item, qty: e.target.value } : item)))}
                />
                <TextField
                  label="Costo por pieza"
                  inputMode="decimal"
                  placeholder="pendiente"
                  value={line.cost}
                  onChange={(e) => setExhibLines((prev) => prev.map((item, i) => (i === index ? { ...item, cost: e.target.value } : item)))}
                />
                <Button
                  variant="ghost"
                  onClick={() => setExhibLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))}
                >
                  Quitar
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExhibLines((prev) => [...prev, { key: uid("exl"), name: "", qty: "", cost: "" }])}
            >
              + Agregar exhibidor
            </Button>
          </div>
          {exhibitorDialogTotal && exhibitorDialogTotal.cents > 0 ? (
            <p className="text-sm text-on-surface-soft">
              Total de la entrega:{" "}
              <span className="font-semibold text-on-surface"><Money exact amount={pesos(exhibitorDialogTotal.cents)} /></span>
              {exhibitorDialogTotal.pending > 0 ? ` · ${exhibitorDialogTotal.pending} ${exhibitorDialogTotal.pending === 1 ? "pieza queda" : "piezas quedan"} por valorar` : ""}
            </p>
          ) : null}
          {exhibitorPlan && exhibitorPlan.check.errors.length > 0 ? (
            <p className="text-xs text-danger">{exhibitorPlan.check.errors.join(" ")}</p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={confirmingCostKey !== null}
        onClose={() => setConfirmingCostKey(null)}
        title="Confirmar costo del exhibidor"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingCostKey(null)}>Cancelar</Button>
            <Button disabled={busy || parseAmount(confirmCostValue.trim()) === undefined} onClick={() => void confirmExhibitorCost()}>
              Confirmar costo
            </Button>
          </>
        }
      >
        {(() => {
          const group = exhibitorGroups.find((candidate) => candidate.key === confirmingCostKey) ?? null;
          if (!group) return null;
          const pending = group.pieces.filter((piece) => piece.withdrawnAt === undefined && piece.unitCostCents === undefined);
          return (
            <div className="space-y-3">
              <p className="text-sm text-on-surface-soft">
                {pending.length} {pending.length === 1 ? "pieza" : "piezas"} de «{group.name}» (entrega del {formatDate(group.deliveredAt)}) esperan su costo.
                Una vez confirmado, el importe queda sellado como evidencia.
              </p>
              <TextField
                label="Costo por pieza"
                inputMode="decimal"
                placeholder="p. ej. 104"
                value={confirmCostValue}
                onChange={(e) => setConfirmCostValue(e.target.value)}
              />
            </div>
          );
        })()}
      </Dialog>

      <Dialog
        open={withdrawingExhibitors}
        onClose={() => setWithdrawingExhibitors(false)}
        title="Retirar exhibidores"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawingExhibitors(false)}>Cancelar</Button>
            <Button
              disabled={busy || !Object.values(exhibWithdrawQty).some((value) => Number(value) > 0) || !isRealDate(exhibWithdrawDate)}
              onClick={() => void confirmExhibitorWithdrawal()}
            >
              Retirar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <TextField
            label="Fecha del retiro"
            inputMode="numeric"
            placeholder="AAAA-MM-DD"
            value={exhibWithdrawDate}
            onChange={(e) => setExhibWithdrawDate(e.target.value)}
          />
          <p className="text-sm text-on-surface-soft">
            Los exhibidores retirados dejan de contar en el costo asignado, pero la entrega y su fecha quedan en el historial.
          </p>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {assignedExhibitorGroups.map((group) => {
              const assigned = group.pieces.filter((piece) => piece.withdrawnAt === undefined);
              return (
                <div key={group.key} className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-1 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-on-surface">
                      {group.name}
                      {group.opening ? " (apertura)" : ""}
                    </p>
                    <p className="text-xs text-on-surface-soft">
                      {assigned.length} asignado{assigned.length === 1 ? "" : "s"} · desde {formatDate(group.deliveredAt)}
                    </p>
                  </div>
                  <div className="w-24">
                    <TextField
                      label="Piezas"
                      inputMode="numeric"
                      placeholder="0"
                      value={exhibWithdrawQty[group.key] ?? ""}
                      onChange={(e) => setExhibWithdrawQty((prev) => ({ ...prev, [group.key]: e.target.value }))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Dialog>
    </Screen>
  );
}
