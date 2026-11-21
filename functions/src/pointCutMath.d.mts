// #524: declarations for the corte math port consumed by the app's
// lockstep equivalence test (see creditMath.d.mts for the precedent).
export interface CorteAllocationPort {
  entryId: string;
  quantity: number;
}
export interface CorteLineAllocationPort {
  lineIndex: number;
  allocations: CorteAllocationPort[];
}
export interface CorteTotalsPort {
  grossSaleCents: number;
  commissionCents: number;
  netCents: number;
  soldCostCents: number | null;
  pendingCostUnits: number;
  writeOffCostCents: number | null;
  writeOffPendingUnits: number;
  resultCents: number | null;
  remainingUnits: number;
}
export interface CortePlanPort {
  saleAllocations: CorteLineAllocationPort[];
  writeOffAllocations: CorteLineAllocationPort[];
  totals: CorteTotalsPort;
  errors: string[];
}
export declare function planCortePort(
  entries: Array<{
    id: string;
    entryDate: string;
    createdAt?: string;
    productId: string;
    variantId?: string;
    quantity: number;
    consumedQty: number;
    markedPriceCents: number;
    unitCostCents?: number;
  }>,
  lines: Array<{ productId: string; variantId?: string; markedPriceCents: number; soldQty: number }>,
  writeOffs: Array<{ productId: string; variantId?: string; markedPriceCents?: number; qty: number; reason?: string }>,
  commissionRate: number
): CortePlanPort;
