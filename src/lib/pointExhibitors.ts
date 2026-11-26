import type { PointExhibitor } from "../types";
import { todayIso } from "./dates";

// #524 — Exhibidores tab. Pure model + rules for fixture (display furniture)
// deliveries at a point of sale: one registry per piece, grouped by delivery
// line. Operational ONLY — separate from cash, cortes, monthly close and
// merchandise inventory; nothing here touches those. Money is exact cents and
// a missing cost is never zero: totals sum CONFIRMED costs and report the
// pieces still lacking valuation.

const NAME_MAX_CHARS = 80;
const QUANTITY_MAX = 500;
const MAX_SAFE_CENTS = 9007199254740991; // Number.MAX_SAFE_INTEGER

/** One entrega row: name, pieces and the optional unit cost (absent = pending). */
export type ExhibitorLineInput = {
  name: string;
  quantity: number;
  unitCostCents?: number;
};

export type ExhibitorDeliveryCheck = {
  canDeliver: boolean;
  /** Operator Spanish, one per offending value; a non-empty list voids the plan. */
  errors: string[];
};

function isRealDateIso(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const round = new Date(Date.UTC(year, month - 1, day));
  return round.getUTCFullYear() === year && round.getUTCMonth() === month - 1 && round.getUTCDate() === day;
}

/**
 * Can this entrega be registered (#524)? The rules: a real physical date
 * (today or earlier, year 2000+), at least one row, and each row with a
 * name, a whole positive quantity and — when the cost is captured — a
 * positive exact-cents amount. Nothing is mutated; the caller decides what
 * to do with the verdict. Blank rows are the UI's business: it only submits
 * filled rows.
 */
export function exhibitorDeliveryImpediments(
  lines: ExhibitorLineInput[],
  physicalDate: string,
  opts: { today?: string } = {}
): ExhibitorDeliveryCheck {
  const errors: string[] = [];
  const today = opts.today ?? todayIso();

  if (!isRealDateIso(physicalDate)) {
    errors.push("La fecha de entrega debe ser un día real con formato AAAA-MM-DD.");
  } else if (physicalDate > today) {
    errors.push("La fecha de entrega no puede ser futura; escribe la fecha real en que llegó.");
  } else if (physicalDate < "2000-01-01") {
    errors.push("La fecha de entrega debe ser del año 2000 en adelante.");
  }

  if (lines.length === 0) {
    errors.push("Agrega al menos un exhibidor con nombre y piezas.");
  }

  lines.forEach((line, index) => {
    const row = index + 1;
    const name = line.name.trim();
    if (!name) errors.push(`Renglón ${row}: escribe el nombre del exhibidor.`);
    else if (name.length > NAME_MAX_CHARS)
      errors.push(`Renglón ${row}: el nombre no puede pasar de ${NAME_MAX_CHARS} caracteres.`);

    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      errors.push(`Renglón ${row}: captura cuántas piezas llegaron (número entero).`);
    } else if (line.quantity > QUANTITY_MAX) {
      errors.push(`Renglón ${row}: registra hasta ${QUANTITY_MAX} piezas por renglón.`);
    }

    if (
      line.unitCostCents !== undefined &&
      (!Number.isInteger(line.unitCostCents) || line.unitCostCents <= 0 || line.unitCostCents > MAX_SAFE_CENTS)
    ) {
      errors.push(`Renglón ${row}: el costo por pieza debe ser un importe mayor a cero.`);
    }
  });

  return { canDeliver: errors.length === 0, errors };
}

export type ExhibitorSummary = {
  /** Σ confirmed unit costs of apertura pieces — history: withdrawals never
   * reduce it (what the point opened with). */
  openingCostCents: number;
  /** Apertura pieces still assigned whose cost awaits confirmation. */
  openingPendingUnits: number;
  /** Σ confirmed unit costs of pieces still assigned to the point. */
  assignedCostCents: number;
  /** Pieces still assigned whose cost awaits confirmation. */
  assignedPendingUnits: number;
};

/**
 * The tab's two headline figures (#524): opening cost and assigned cost in
 * exact cents, plus how many pieces still lack a valuation. Only CONFIRMED
 * costs are summed; a withdrawn piece keeps counting toward the opening
 * (historical cost) but not toward the assigned total, and a withdrawn piece
 * without a cost stops asking for one.
 */
export function exhibitorSummary(
  pieces: Array<Pick<PointExhibitor, "opening" | "withdrawnAt" | "unitCostCents">>
): ExhibitorSummary {
  let openingCostCents = 0;
  let openingPendingUnits = 0;
  let assignedCostCents = 0;
  let assignedPendingUnits = 0;
  for (const piece of pieces) {
    const assigned = piece.withdrawnAt === undefined;
    if (typeof piece.unitCostCents === "number") {
      if (piece.opening) openingCostCents += piece.unitCostCents;
      if (assigned) assignedCostCents += piece.unitCostCents;
    } else if (assigned) {
      if (piece.opening) openingPendingUnits += 1;
      assignedPendingUnits += 1;
    }
  }
  return { openingCostCents, openingPendingUnits, assignedCostCents, assignedPendingUnits };
}

export type ExhibitorGroupPiece = Pick<
  PointExhibitor,
  "id" | "name" | "deliveredAt" | "createdAt" | "unitCostCents" | "costConfirmedAt" | "withdrawnAt" | "withdrawnBy"
>;

export type ExhibitorLineGroup = {
  /** `${deliveryId}__${lineIndex}` — stable identity of the row. */
  key: string;
  deliveryId: string;
  lineIndex: number;
  name: string;
  deliveredAt: string;
  opening: boolean;
  pieces: ExhibitorGroupPiece[];
};

function pieceAgeKey(piece: { deliveredAt: string; createdAt?: string; id: string }): string {
  return [piece.deliveredAt, piece.createdAt ?? "", piece.id].join("|");
}

/**
 * Group the pieces by delivery row for the interface (#524): pieces of one
 * entrega's row stay together (they share name and unit cost), entregas stay
 * apart even when names repeat. Rows sort oldest delivery first; pieces
 * within a row sort oldest first so withdrawals take from the top.
 */
export function groupExhibitorsByLine(pieces: Array<PointExhibitor>): ExhibitorLineGroup[] {
  const groups = new Map<string, ExhibitorLineGroup>();
  for (const piece of pieces) {
    const key = `${piece.deliveryId}__${piece.lineIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        deliveryId: piece.deliveryId,
        lineIndex: piece.lineIndex,
        name: piece.name,
        deliveredAt: piece.deliveredAt,
        opening: piece.opening,
        pieces: [],
      };
      groups.set(key, group);
    }
    group.pieces.push(piece);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    [a.deliveredAt, a.deliveryId, String(a.lineIndex).padStart(4, "0")].join("|").localeCompare(
      [b.deliveredAt, b.deliveryId, String(b.lineIndex).padStart(4, "0")].join("|")
    )
  );
  for (const group of ordered) {
    group.pieces.sort((a, b) => pieceAgeKey(a).localeCompare(pieceAgeKey(b)));
  }
  return ordered;
}

/**
 * Which pieces a qty-based withdrawal takes from one row (#524): the oldest
 * assigned pieces first, never crossing into other rows or entregas.
 * `shortUnits` reports what the row could not cover — the caller does not
 * write anything when it is positive. Mirrored server-side by the
 * withdrawPointExhibitors callable (see pointExhibitors.mjs).
 */
export function pickWithdrawalPieces(
  pieces: Array<Pick<PointExhibitor, "id" | "deliveryId" | "lineIndex" | "deliveredAt" | "withdrawnAt"> & { createdAt?: string }>,
  line: { deliveryId: string; lineIndex: number; quantity: number }
): { ids: string[]; shortUnits: number } {
  const candidates = pieces
    .filter(
      (piece) => piece.deliveryId === line.deliveryId && piece.lineIndex === line.lineIndex && piece.withdrawnAt === undefined
    )
    .sort((a, b) => pieceAgeKey(a).localeCompare(pieceAgeKey(b)));
  const ids = candidates.slice(0, line.quantity).map((piece) => piece.id);
  return { ids, shortUnits: Math.max(0, line.quantity - candidates.length) };
}
