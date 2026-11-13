export function orderAmountCents(amount: number, quantity?: number): number;
export function orderTotalCents(order: Record<string, unknown>): number;
export function incidentsSaleAdjustmentCents(incidents: unknown[] | undefined | null): number;
export function incidentsRefundCommittedCents(incidents: unknown[] | undefined | null): number;
export function docReceivedCents(order: Record<string, unknown>): number;
export function creditAvailableCents(order: Record<string, unknown>): number;
export function pendingCents(order: Record<string, unknown>): number;
export function netByOrigin(ledger: unknown[] | undefined | null): Map<string, number>;
