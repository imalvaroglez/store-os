// #524: trusted point-of-sale operations. The Firestore rules deny EVERY
// client write to pointEntries/pointOperations (the Admin SDK bypasses rules
// via IAM), so the first-surtido conversion goes through the
// convertOrderToFirstSurtido callable. The callable authenticates the
// caller, resolves membership and re-validates the order inside its own
// transaction; this module is the typed client (creditFunctions idiom).
import { httpsCallable } from "firebase/functions";
import { functionsInstance } from "./functions";

export interface ConvertOrderParams {
  storeId: string;
  pointId: string;
  orderId: string;
  /** Physical delivery date (YYYY-MM-DD) the pieces entered the point. */
  physicalDate: string;
  intentId: string;
}

export interface ConvertOrderResult {
  converted: boolean;
  alreadyConverted?: boolean;
  entryCount?: number;
  units?: number;
  pointId?: string;
}

export async function convertOrderTrusted(params: ConvertOrderParams): Promise<ConvertOrderResult> {
  const call = httpsCallable<ConvertOrderParams, ConvertOrderResult>(functionsInstance(), "convertOrderToFirstSurtido");
  const res = await call(params);
  return res.data;
}

export interface RegisterPointCutParams {
  storeId: string;
  pointId: string;
  intentId: string;
  effectiveDate: string;
  commissionRate: number;
  lines: Array<{ productId: string; variantId?: string; markedPriceCents: number; soldQty: number }>;
  writeOffs: Array<{ productId: string; variantId?: string; qty: number; reason: string }>;
}

export interface RegisterPointCutResult {
  registered: boolean;
  alreadyRegistered?: boolean;
  corteId?: string;
  totals?: RegisterPointCutParams extends never ? never : Record<string, unknown>;
}

export async function registerPointCutTrusted(params: RegisterPointCutParams): Promise<RegisterPointCutResult> {
  const call = httpsCallable<RegisterPointCutParams, RegisterPointCutResult>(functionsInstance(), "registerPointCut");
  const res = await call(params);
  return res.data;
}

export interface RegisterPointCutPaymentParams {
  storeId: string;
  pointId: string;
  corteId: string;
  intentId: string;
  method: "cash" | "transfer";
  date: string;
}

export interface RegisterPointCutPaymentResult {
  registered: boolean;
  alreadyRegistered?: boolean;
  amountCents?: number;
  date?: string;
  method?: string;
}

export async function registerPointCutPaymentTrusted(params: RegisterPointCutPaymentParams): Promise<RegisterPointCutPaymentResult> {
  const call = httpsCallable<RegisterPointCutPaymentParams, RegisterPointCutPaymentResult>(functionsInstance(), "registerPointCutPayment");
  const res = await call(params);
  return res.data;
}

export interface AnnulPointCutParams {
  storeId: string;
  pointId: string;
  corteId: string;
  intentId: string;
  motive: string;
}

export interface AnnulPointCutResult {
  registered: boolean;
  alreadyRegistered?: boolean;
}

export async function annulPointCutTrusted(params: AnnulPointCutParams): Promise<AnnulPointCutResult> {
  const call = httpsCallable<AnnulPointCutParams, AnnulPointCutResult>(functionsInstance(), "annulPointCut");
  const res = await call(params);
  return res.data;
}

export interface StockPointLine {
  productId: string;
  variantId?: string;
  qty: number;
  markedPriceCents: number;
  unitCostCents?: number;
}

export interface StockPointResult {
  stocked: boolean;
  alreadyStocked?: boolean;
  entryCount?: number;
  units?: number;
}

export async function stockPointTrusted(params: {
  storeId: string;
  pointId: string;
  intentId: string;
  physicalDate: string;
  lines: StockPointLine[];
}): Promise<StockPointResult> {
  const call = httpsCallable<Parameters<typeof stockPointTrusted>[0], StockPointResult>(functionsInstance(), "stockPointFromWarehouse");
  const res = await call(params);
  return res.data;
}

export interface WithdrawLine {
  productId: string;
  variantId?: string;
  qty: number;
}

export interface WithdrawResult {
  withdrawn: boolean;
  alreadyWithdrawn?: boolean;
  units?: number;
}

export async function withdrawFromPointTrusted(params: {
  storeId: string;
  pointId: string;
  intentId: string;
  lines: WithdrawLine[];
}): Promise<WithdrawResult> {
  const call = httpsCallable<Parameters<typeof withdrawFromPointTrusted>[0], WithdrawResult>(functionsInstance(), "withdrawFromPoint");
  const res = await call(params);
  return res.data;
}

// #524 Exhibidores tab: same trusted-callable contract as the stock moves —
// the registry is evidence, so the client never writes pointExhibitors.

export interface DeliverExhibitorLine {
  name: string;
  quantity: number;
  /** Absent = pending valuation, confirmable later on the same record. */
  unitCostCents?: number;
}

export interface DeliverExhibitorsResult {
  delivered: boolean;
  alreadyDelivered?: boolean;
  pieces?: number;
}

export async function deliverExhibitorsTrusted(params: {
  storeId: string;
  pointId: string;
  intentId: string;
  physicalDate: string;
  opening: boolean;
  lines: DeliverExhibitorLine[];
}): Promise<DeliverExhibitorsResult> {
  const call = httpsCallable<Parameters<typeof deliverExhibitorsTrusted>[0], DeliverExhibitorsResult>(functionsInstance(), "deliverPointExhibitors");
  const res = await call(params);
  return res.data;
}

export interface ConfirmExhibitorCostResult {
  confirmed?: number;
  alreadyConfirmed?: number;
}

export async function confirmExhibitorCostTrusted(params: {
  storeId: string;
  pointId: string;
  items: Array<{ exhibitorId: string; unitCostCents: number }>;
}): Promise<ConfirmExhibitorCostResult> {
  const call = httpsCallable<Parameters<typeof confirmExhibitorCostTrusted>[0], ConfirmExhibitorCostResult>(functionsInstance(), "confirmPointExhibitorCost");
  const res = await call(params);
  return res.data;
}

export interface WithdrawExhibitorLine {
  deliveryId: string;
  lineIndex: number;
  quantity: number;
}

export interface WithdrawExhibitorsResult {
  withdrawn: boolean;
  alreadyWithdrawn?: boolean;
  pieces?: number;
}

export async function withdrawExhibitorsTrusted(params: {
  storeId: string;
  pointId: string;
  intentId: string;
  physicalDate: string;
  lines: WithdrawExhibitorLine[];
}): Promise<WithdrawExhibitorsResult> {
  const call = httpsCallable<Parameters<typeof withdrawExhibitorsTrusted>[0], WithdrawExhibitorsResult>(functionsInstance(), "withdrawPointExhibitors");
  const res = await call(params);
  return res.data;
}
