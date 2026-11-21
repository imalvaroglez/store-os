// #524: the corte math PORT used by the trusted registerPointCut /
// registerPointCutPayment / annulPointCut callables. Kept in lockstep with
// the app's TypeScript source of truth (src/lib/pointOfSale.ts planCorte)
// by the equivalence test in the app suite (pointCutMathPort.test.ts) — the
// port must produce identical plans for every fixture; if they diverge, the
// test fails and the callable must not ship.
//
// All money is exact cents; the commission rounds ONCE.

function fifoKey(entry) {
  return [entry.entryDate, entry.createdAt ?? "", entry.id ?? ""].join("|");
}

export function planCortePort(entries, lines, writeOffs, commissionRate) {
  const errors = [];
  const state = new Map(entries.map((entry) => [entry.id, { entry, left: Math.max(0, entry.quantity - entry.consumedQty) }]));
  const fifoSorted = [...entries].sort((a, b) => fifoKey(a).localeCompare(fifoKey(b)));
  const dimension = (productId, variantId, entry) =>
    entry.productId === productId && (entry.variantId ?? "") === (variantId ?? "");

  function consume(productId, variantId, priceCents, qty) {
    const allocations = [];
    let need = qty;
    for (const entry of fifoSorted) {
      if (need <= 0) break;
      if (!dimension(productId, variantId, entry)) continue;
      if (priceCents !== undefined && entry.markedPriceCents !== priceCents) continue;
      const cell = state.get(entry.id);
      if (cell.left <= 0) continue;
      const take = Math.min(cell.left, need);
      cell.left -= take;
      allocations.push({ entryId: entry.id, quantity: take });
      need -= take;
    }
    return { allocations, short: need };
  }

  const saleAllocations = [];
  lines.forEach((line, index) => {
    if (line.soldQty <= 0) return;
    const { allocations, short } = consume(line.productId, line.variantId, line.markedPriceCents, line.soldQty);
    if (short > 0) {
      errors.push(`No hay suficientes piezas a ese precio para vender ${line.soldQty}: faltan ${short}.`);
      return;
    }
    saleAllocations.push({ lineIndex: index, allocations });
  });

  const writeOffAllocations = [];
  writeOffs.forEach((writeOff, index) => {
    if (writeOff.qty <= 0) return;
    const { allocations, short } = consume(writeOff.productId, writeOff.variantId, undefined, writeOff.qty);
    if (short > 0) {
      errors.push(`No hay suficientes piezas para dar de baja ${writeOff.qty}: faltan ${short}.`);
      return;
    }
    writeOffAllocations.push({ lineIndex: index, allocations });
  });

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  function costOf(allocations) {
    let cents = 0;
    let pendingUnits = 0;
    let unknown = false;
    for (const allocation of allocations) {
      const entry = byId.get(allocation.entryId);
      if (!entry) continue;
      if (typeof entry.unitCostCents === "number") cents += entry.unitCostCents * allocation.quantity;
      else {
        pendingUnits += allocation.quantity;
        unknown = true;
      }
    }
    return { cents, pendingUnits, unknown };
  }

  let grossSaleCents = 0;
  const soldFlat = [];
  lines.forEach((line, index) => {
    if (line.soldQty <= 0) return;
    const allocation = saleAllocations.find((candidate) => candidate.lineIndex === index);
    if (!allocation) return;
    grossSaleCents += line.markedPriceCents * line.soldQty;
    soldFlat.push(...allocation.allocations);
  });
  const writeOffFlat = writeOffAllocations.flatMap((candidate) => candidate.allocations);

  const soldCost = costOf(soldFlat);
  const writeOffCost = costOf(writeOffFlat);
  const commissionCents = Math.round(grossSaleCents * commissionRate);
  const netCents = grossSaleCents - commissionCents;
  const costComplete = !soldCost.unknown && !writeOffCost.unknown;

  return {
    saleAllocations,
    writeOffAllocations,
    totals: {
      grossSaleCents,
      commissionCents,
      netCents,
      soldCostCents: soldCost.unknown ? null : soldCost.cents,
      pendingCostUnits: soldCost.pendingUnits,
      writeOffCostCents: writeOffCost.unknown ? null : writeOffCost.cents,
      writeOffPendingUnits: writeOffCost.pendingUnits,
      resultCents: costComplete ? netCents - soldCost.cents - writeOffCost.cents : null,
      remainingUnits: [...state.values()].reduce((sum, cell) => sum + cell.left, 0),
    },
    errors,
  };
}
