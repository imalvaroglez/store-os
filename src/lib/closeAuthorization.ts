import type { MonthlyClose } from "./monthlyClose";

// #458 — the OFFICIAL close. A preview is never a close: this module derives
// the period's STATE and its human impediments, builds the versioned snapshot
// and computes the deterministic doc id (a retry lands on the SAME doc —
// idempotent by construction). Authorization is OWNER-ONLY (Firestore rules
// enforce it; the UI never relies on hiding a button).

export type CloseQueueKey = "pedidos" | "cobros" | "costo";

export type CloseImpediment = { reason: string; queue?: CloseQueueKey };

export type ExistingClose = {
  id: string;
  version: number;
  authorizedByUid: string;
  authorizedAt: string;
  totals: { operatingResultCents?: number };
};

export type CloseStatus = {
  state: "en_curso" | "en_revision" | "listo" | "cerrado";
  canClose: boolean;
  impediments: CloseImpediment[];
  closedBy?: string;
  closedAt?: string;
  closedVersion?: number;
};

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function periodKey(month: { year: number; month: number }): string {
  return `${month.year}-${String(month.month).padStart(2, "0")}`;
}

/** Last day (CDMX calendar) of the month, as YYYY-MM-DD. */
function lastDayOfMonth(month: { year: number; month: number }): string {
  const last = new Date(Date.UTC(month.year, month.month, 0));
  return `${month.year}-${String(month.month).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`;
}

/** The period's state from month end, coverage and any authorized snapshot.
 * `activationDate` (the store's createdAt, date part): when the store was
 * activated MID-month, that month is a PARTIAL financial period — it can
 * never be declared «íntegro» without an explicit PO policy (#458 r2
 * review MAYOR-3: fail closed with a human reason). */
export function closeStatus(input: {
  month: { year: number; month: number };
  today: string;
  close: MonthlyClose;
  existing?: ExistingClose;
  activationDate?: string;
}): CloseStatus {
  const { month, today, close, existing } = input;
  const monthName = `${MONTH_NAMES[month.month - 1]}`;

  if (existing) {
    return {
      state: "cerrado",
      canClose: false,
      impediments: [],
      closedBy: existing.authorizedByUid,
      closedAt: existing.authorizedAt,
      closedVersion: existing.version,
    };
  }

  if (today <= lastDayOfMonth(month)) {
    return {
      state: "en_curso",
      canClose: false,
      impediments: [{ reason: "El mes aún no termina" }],
    };
  }

  const firstDay = `${month.year}-${String(month.month).padStart(2, "0")}-01`;
  const partialFromActivation = !!input.activationDate && input.activationDate > firstDay;
  if (partialFromActivation) {
    return {
      state: "en_revision",
      canClose: false,
      impediments: [
        {
          reason: `Periodo financiero parcial desde la activación (${input.activationDate}) — declararlo íntegro requiere una política explícita`,
        },
      ],
    };
  }

  const impediments: CloseImpediment[] = [];
  const c = close.coverage;
  if (c.deliveredWithoutDate.length > 0) {
    impediments.push({ reason: `Faltan fechas de entrega verificables que podrían afectar ${monthName}`, queue: "pedidos" });
  }
  if (c.unconfirmedCollections.length > 0) {
    impediments.push({ reason: `Hay cobros sin fecha que podrían pertenecer a ${monthName}`, queue: "cobros" });
  }
  if (c.linesWithoutCost.length > 0) {
    impediments.push({ reason: `Hay un costo desconocido que podría afectar ${monthName}`, queue: "costo" });
  }
  if (c.deliveredWithoutLine.length > 0 || c.unreadableData.length > 0) {
    impediments.push({ reason: "Hay entregas con evidencia que no se puede interpretar del todo", queue: "pedidos" });
  }

  if (impediments.length > 0) {
    return { state: "en_revision", canClose: false, impediments };
  }
  return { state: "listo", canClose: true, impediments: [] };
}

/** Deterministic doc id: retry of the same intent = the same doc. */
export function closeDocId(storeId: string, month: { year: number; month: number }, version: number): string {
  return `${storeId}__${periodKey(month)}__v${version}`;
}

export function nextCloseVersion(latest?: number): number {
  return (latest ?? 0) + 1;
}

/** Stable fingerprint of the close's sources — changes when the underlying
 * contributions change (same inputs, same hash). */
export function snapshotFingerprint(close: MonthlyClose): string {
  const source = JSON.stringify({
    s: close.details.sales,
    c: close.details.costs,
    e: close.details.expenses,
    p: close.details.collections,
  });
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return `fp_${(hash >>> 0).toString(36)}`;
}

/** The immutable versioned snapshot (Firestore rules demand id==body.id and
 * createdBy==uid — the #202 closes collection contract). */
export function buildCloseSnapshot(input: {
  storeId: string;
  close: MonthlyClose;
  uid: string;
  now: string;
  version: number;
}) {
  const { storeId, close, uid, now, version } = input;
  const id = closeDocId(storeId, close.month, version);
  return {
    id,
    storeId,
    period: periodKey(close.month),
    version,
    monthLabel: close.monthLabel,
    totals: {
      salesCents: close.salesCents,
      costCents: close.costCents,
      expensesCents: close.expensesCents,
      operatingResultCents: close.operatingResultCents,
      collectionsCents: close.collectionsCents,
    },
    coverageComplete: close.coverage.complete,
    fingerprint: snapshotFingerprint(close),
    state: "closed" as const,
    authorizedByUid: uid,
    authorizedAt: now,
    createdBy: uid,
    createdAt: now,
  };
}

/** Firestore document shape for the closes collection (#202 rules contract). */
export type CloseSnapshotDoc = {
  id: string;
  storeId: string;
  period: string;
  version: number;
  monthLabel: string;
  totals: {
    salesCents: number;
    costCents: number;
    expensesCents: number;
    operatingResultCents: number;
    collectionsCents: number;
  };
  coverageComplete: boolean;
  fingerprint: string;
  state: "closed";
  authorizedByUid: string;
  authorizedAt: string;
  createdBy: string;
  createdAt: string;
};
