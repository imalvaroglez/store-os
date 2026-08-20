export declare function parseMoney(raw: string | number): number | undefined;
export type ParsedLine = { name: string; quantity: number; unitAmount: number; color?: string };
export type ParsedOrder = {
  supplierOrder?: string; dateLabel?: string; lines: ParsedLine[];
  subtotal?: number; total?: number; discount?: number;
};
export declare function parseSupplierOrder(text: string): ParsedOrder;
