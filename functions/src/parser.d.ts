export declare function parseMoney(raw: string | number): number | undefined;
export type ParsedLine = {
  name: string;
  quantity: number;
  sourceAmount: number;
  variant?: string;
  unitCost?: number;
};
export type ParsedOrder = {
  supplierOrder?: string;
  dateLabel?: string;
  currency: string;
  supplierCandidate?: string;
  lines: ParsedLine[];
  subtotal?: number;
  discount?: number;
  shipping?: number;
  taxIncluded?: number;
  total?: number;
  sourceAmountType: "unit" | "line" | "unknown";
  needsReview: boolean;
};
export declare function parseSupplierOrder(text: string): ParsedOrder;
export declare function reconcileAmountType(
  lines: { sourceAmount: number; quantity: number }[],
  reference?: number
): "unit" | "line" | "unknown";
