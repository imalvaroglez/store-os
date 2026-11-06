import { parseAmount, formatMoneyExact } from "../../lib/money";
import { legacyPurchaseTicket } from "../../lib/purchases";
import { purchaseTicketTotals, purchaseTotals, type Purchase } from "../../types";

export type PurchaseReviewIssue = {
  ticketId: string;
  target: string;
  message: string;
  input?: boolean;
};
export const ticketAmountKey = (ticketId: string, field: string) => `ticket:${ticketId}:${field}`;

/** UI diagnostics only; readiness and receipt still use the canonical rules. */
export function purchaseReviewIssues(purchase: Purchase, drafts: Record<string, string>): PurchaseReviewIssue[] {
  const issues: PurchaseReviewIssue[] = [];
  const tickets = purchase.tickets ?? [legacyPurchaseTicket(purchase)];
  for (const ticket of tickets) {
    const lines = purchase.lines.filter((line) => (line.ticketId ?? tickets[0].id) === ticket.id);
    for (const line of lines) {
      const quantityKey = `quantity:${line.lineId}`;
      const costKey = `line:${line.lineId}`;
      const quantity = drafts[quantityKey] == null ? line.quantity : parseAmount(drafts[quantityKey]);
      const cost = drafts[costKey] == null ? line.unitCost : parseAmount(drafts[costKey]);
      const name = line.name || "Producto sin nombre";
      if (quantity == null || !Number.isSafeInteger(quantity) || quantity <= 0) {
        issues.push({ ticketId: ticket.id, target: quantityKey, message: `${name}: Cantidad debe ser un entero mayor que cero.`, input: true });
      }
      if (cost == null || !Number.isFinite(cost) || cost < 0) {
        issues.push({ ticketId: ticket.id, target: costKey, message: `${name}: Costo unitario debe ser un importe válido, positivo o cero.`, input: true });
      }
      if (line.sourceAmountType === "unknown") {
        issues.push({ ticketId: ticket.id, target: `source:${line.lineId}`, message: `${name}: elige si el importe del PDF es unitario o total por línea.` });
      }
      if (!line.productId) {
        issues.push({ ticketId: ticket.id, target: `link:${line.lineId}`, message: `${name}: vincula o crea el producto.` });
      }
    }
    const totals = purchase.tickets ? purchaseTicketTotals(purchase, ticket.id) : purchaseTotals(purchase);
    for (const [field, label] of [["discount", "Descuento"], ["shipping", "Envío"], ["tax", "Impuestos"], ["totalConfirmed", "Total pagado"]] as const) {
      const key = ticketAmountKey(ticket.id, field);
      const raw = drafts[key];
      const amount = raw == null ? ticket[field] ?? 0 : raw.trim() === "" && field !== "totalConfirmed" ? 0 : parseAmount(raw);
      if (amount == null || !Number.isFinite(amount) || amount < 0) {
        issues.push({ ticketId: ticket.id, target: key, message: `${label}: escribe un importe válido, positivo o cero.`, input: true });
      }
    }
    if (lines.length === 0) {
      issues.push({ ticketId: ticket.id, target: `add:${ticket.id}`, message: "Agrega productos o quita este ticket vacío." });
    }
    if ((ticket.discount ?? 0) - totals.merchandise > 0.005) {
      issues.push({ ticketId: ticket.id, target: ticketAmountKey(ticket.id, "discount"), message: "Descuento: no puede ser mayor que el subtotal de productos." });
    }
    const difference = Math.abs(totals.calculated - ticket.totalConfirmed);
    if (Number.isFinite(difference) && difference > 0.005 && !issues.some((issue) => issue.ticketId === ticket.id && issue.input)) {
      issues.push({ ticketId: ticket.id, target: ticketAmountKey(ticket.id, "totalConfirmed"), message: `Total pagado: hay una diferencia de ${formatMoneyExact(difference)}. Revisa el ticket, sus productos y ajustes.` });
    }
  }
  return issues;
}
